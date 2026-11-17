import { exportSubgraph } from "../graph/subgraphIo";
import { parseKShader } from "../serialization/kshader";

/** The `.kshadersub` text of one subgraph of a sample file (the bundle "Export subgraph" produces: the subgraph + its dependencies). Null if it does not exist. */
export const sampleSubgraphBundle = (text: string, subgraphId: string): string | null => exportSubgraph(parseKShader(text).graph, subgraphId);
