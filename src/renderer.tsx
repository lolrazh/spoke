import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, MotionConfig } from "framer-motion";
import "./index.css";

window.electron?.bootMark?.("module-loaded");

// Load only animation and gesture features. Components render with the
// lightweight `m` primitives, and the app does not use Motion's layout or drag
// props, so the larger domMax bundle would be unused code.
const loadMotionFeatures = () =>
  import("./motionFeatures").then((mod) => mod.domAnimation);

const App = lazy(() => {
  window.electron?.bootMark?.("route:app-import:start");
  return import("./components/App").then((module) => {
    window.electron?.bootMark?.("route:app-import:done");
    return module;
  });
});

const Onboarding = lazy(() => {
  window.electron?.bootMark?.("route:onboarding-import:start");
  return import("./components/Onboarding").then((module) => {
    window.electron?.bootMark?.("route:onboarding-import:done");
    return module;
  });
});

function readHashRoute(): string {
  const route = window.location.hash.replace(/^#/, "");
  return route || "/";
}

function useHashRoute(): string {
  const [route, setRoute] = useState(readHashRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(readHashRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return route.split("?", 1)[0] || "/";
}

function mountReact(root: HTMLElement) {
  window.electron?.bootMark?.("react-render:start");
  const reactRoot = createRoot(root);
  const RoutedApp = () => {
    const route = useHashRoute();
    return route === "/onboarding" ? <Onboarding /> : <App />;
  };

  reactRoot.render(
    // Non-strict LazyMotion: if any `motion.` usage is missed it still renders
    // (loading the full features) instead of throwing.
    <LazyMotion features={loadMotionFeatures} strict={false}>
      <MotionConfig reducedMotion="user">
        <Suspense fallback={null}>
          <RoutedApp />
        </Suspense>
      </MotionConfig>
    </LazyMotion>,
  );
  window.electron?.bootMark?.("react-render:scheduled");
}

// Add a temporary class to body to avoid any first-paint flash
try {
  document.body.classList.add("initial-fade");
} catch {}

const existing = document.getElementById("root");
if (existing) {
  mountReact(existing);
} else {
  const created = document.createElement("div");
  created.id = "root";
  document.body.appendChild(created);
  mountReact(created);
}

// Signal main after the first frame. Fonts use font-display: swap, so waiting
// on document.fonts.ready can turn a slow font load into a hidden black window.
requestAnimationFrame(() => {
  window.electron?.bootMark?.("first-animation-frame");
});

console.log("🎤 Spoke is running");
