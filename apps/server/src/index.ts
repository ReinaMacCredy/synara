import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CliConfig, veylenCli } from "./main";
import { OpenLive } from "./open";
import { Command } from "effect/unstable/cli";
import { version } from "../package.json" with { type: "json" };
import { ServerLive } from "./effectServer";
import { NetService } from "@veylen/shared/Net";
import { applyLegacyEnvironmentAliases } from "@veylen/shared/veylenHome";
import { FetchHttpClient } from "effect/unstable/http";

applyLegacyEnvironmentAliases();

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

Command.run(veylenCli, { version })
  .pipe(Effect.provide(RuntimeLayer))
  .pipe((program) => NodeRuntime.runMain(program as Effect.Effect<void, unknown, never>));
