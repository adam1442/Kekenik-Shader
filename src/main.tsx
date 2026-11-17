import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./index.css";
import App from "./App";

// StrictMode is intentionally not used: dockview mounts imperative DOM that must not be double-initialised.
createRoot(document.getElementById("root")!).render(<App />);
