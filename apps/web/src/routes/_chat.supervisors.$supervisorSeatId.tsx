import { SupervisorSeatId } from "@synara/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { SupervisorSurface } from "~/components/supervision/SupervisorSurface";
import { useStore } from "~/store";

import { resolveSupervisorSeatRouteState } from "./-supervisorSeatRouteState";

function SupervisorSeatRouteView() {
  const { supervisorSeatId: rawSupervisorSeatId } = Route.useParams();
  const supervisorSeatId = SupervisorSeatId.makeUnsafe(rawSupervisorSeatId);
  const snapshot = useStore((state) => state.supervision);
  const routeState = resolveSupervisorSeatRouteState(snapshot, supervisorSeatId);

  if (routeState.kind === "missing") {
    return (
      <PanelStateMessage>
        This Supervisor seat does not exist or is still loading.
      </PanelStateMessage>
    );
  }

  return <SupervisorSurface snapshot={snapshot} supervisorSeatId={supervisorSeatId} />;
}

export const Route = createFileRoute("/_chat/supervisors/$supervisorSeatId")({
  component: SupervisorSeatRouteView,
});
