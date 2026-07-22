import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { OverlayApp } from "./OverlayApp";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Renderer root element is missing");

const surface = new URLSearchParams(window.location.search).get("surface");
document.documentElement.classList.add("dark");
document.documentElement.dataset.surface =
  surface === "overlay" ? "overlay" : "shell";

createRoot(root).render(
  <StrictMode>{surface === "overlay" ? <OverlayApp /> : <App />}</StrictMode>,
);
