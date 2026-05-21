// src/ui/App.tsx — the Ink root. Completed items (and the banner) go in
// <Static> so they scroll into terminal history; the streaming region and the
// status bar are the live, re-rendered area.

import { Box, Static } from "ink";
import { useSyncExternalStore } from "react";
import { ui, type ConvItem } from "./store.js";
import { VERSION } from "../version.js";
import { Banner } from "./components/Banner.js";
import { ItemView, LiveStream } from "./components/Conversation.js";
import { StatusBar } from "./components/StatusBar.js";

type StaticEntry = ConvItem | { id: number; kind: "banner" };

interface AppProps {
  model: string;
  rag: boolean;
}

export function App({ model, rag }: AppProps) {
  // Re-render whenever the store changes.
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);

  const staticItems: StaticEntry[] = [{ id: 0, kind: "banner" }, ...ui.items];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Static items={staticItems}>
        {(item) =>
          item.kind === "banner" ? (
            <Banner
              key="banner"
              version={VERSION}
              model={model}
              rag={rag}
              sandbox={ui.status.cwd}
            />
          ) : (
            <ItemView key={item.id} item={item} />
          )
        }
      </Static>
      <LiveStream />
      <Box marginTop={1}>
        <StatusBar status={ui.status} />
      </Box>
    </Box>
  );
}
