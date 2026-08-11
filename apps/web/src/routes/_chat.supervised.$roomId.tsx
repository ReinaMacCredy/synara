import { type ProjectId, ThreadId } from "@veylen/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { SingleChatSurface } from "~/components/chat/SingleChatSurface";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { useComposerDraftStore } from "~/composerDraftStore";
import { supervisedRuntimeQueryOptions } from "~/lib/supervisedRuntime";
import { useStore } from "~/store";
import { createThreadSelector } from "~/storeSelectors";

export interface SupervisedRoomSearch {
  readonly projectId?: ProjectId;
  readonly editorFilePath?: string;
  readonly view?: "chat";
}

function SupervisedRoomRouteView() {
  const navigate = useNavigate();
  const roomId = Route.useParams({ select: (params) => params.roomId });
  const threadId = ThreadId.makeUnsafe(roomId);
  const search = Route.useSearch();
  const thread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));
  const draft = useComposerDraftStore((state) => state.draftThreadsByThreadId[threadId] ?? null);
  const runtime = useQuery(supervisedRuntimeQueryOptions());
  const projectId = thread?.projectId ?? draft?.projectId ?? search.projectId ?? null;
  const roomName = runtime.data?.rooms.find((room) => room.id === roomId)?.title ?? "Lead Room";

  if (!projectId) {
    return (
      <RouteInsetSurface>
        <PanelStateMessage>This Lead Room is no longer available.</PanelStateMessage>
      </RouteInsetSurface>
    );
  }

  return (
    <SingleChatSurface
      threadId={threadId}
      projectId={projectId}
      search={{
        ...(search.view === "chat" ? {} : { view: "editor" as const }),
        ...(search.editorFilePath ? { editorFilePath: search.editorFilePath } : {}),
      }}
      roomView={{
        roomId,
        roomName,
        onEnter: () =>
          void navigate({
            to: "/supervised/$roomId",
            params: { roomId },
            search: { projectId },
          }),
        onExit: () =>
          void navigate({
            to: "/supervised/$roomId",
            params: { roomId },
            search: { projectId, view: "chat" },
          }),
        onSelectFile: (editorFilePath) =>
          void navigate({
            to: "/supervised/$roomId",
            params: { roomId },
            replace: true,
            search: { projectId, editorFilePath },
          }),
        onSelectProject: (nextProjectId) =>
          void navigate({ to: "/supervised", search: { projectId: nextProjectId } }),
      }}
    />
  );
}

export const Route = createFileRoute("/_chat/supervised/$roomId")({
  validateSearch: (raw: Record<string, unknown>): SupervisedRoomSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.editorFilePath === "string" && raw.editorFilePath.length > 0
      ? { editorFilePath: raw.editorFilePath }
      : {}),
    ...(raw.view === "chat" ? { view: "chat" as const } : {}),
  }),
  component: SupervisedRoomRouteView,
});
