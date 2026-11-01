import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Literata, bundled with the app: regular and medium (spec 12.2).
import "@fontsource/literata/400.css";
import "@fontsource/literata/500.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
