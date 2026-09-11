import { createRoot } from "react-dom/client";
import App from "./app/App";
createRoot(document.getElementById("root")!).render(<App />);
import { registerOffline } from "./offline";
if (import.meta.env.PROD)
  void registerOffline({
    hasActiveSession: () =>
      document.documentElement.dataset.sessionActive === "true",
  });
