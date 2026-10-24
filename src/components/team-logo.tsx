"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  displayedTeamLogoSource,
  startTeamLogoLoadTimeout,
  type TeamLogoLoadStatus,
} from "@/lib/schedule/logo-load-timeout";

const PLACEHOLDER_LOGO = "/team-placeholder.svg";

const nearViewportCallbacks = new WeakMap<Element, () => void>();
let nearViewportObserver: IntersectionObserver | null = null;

function observeNearViewport(element: Element, callback: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => undefined;
  }

  nearViewportObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const onNearViewport = nearViewportCallbacks.get(entry.target);
      nearViewportCallbacks.delete(entry.target);
      nearViewportObserver?.unobserve(entry.target);
      onNearViewport?.();
    }
  }, { rootMargin: "1200px" });

  nearViewportCallbacks.set(element, callback);
  nearViewportObserver.observe(element);
  return () => {
    nearViewportCallbacks.delete(element);
    nearViewportObserver?.unobserve(element);
  };
}

export function TeamLogo({ src }: { src: string }) {
  const source = src.trim() || PLACEHOLDER_LOGO;
  const imageRef = useRef<HTMLImageElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [status, setStatus] = useState<TeamLogoLoadStatus>("loading");
  const displayedSource = displayedTeamLogoSource(source, PLACEHOLDER_LOGO, nearViewport, status);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    return observeNearViewport(image, () => setNearViewport(true));
  }, []);

  useEffect(() => {
    if (!nearViewport || status !== "loading" || source === PLACEHOLDER_LOGO) return;
    return startTeamLogoLoadTimeout(() => setStatus("failed"));
  }, [nearViewport, source, status]);

  return (
    <Image
      ref={imageRef}
      src={displayedSource}
      alt=""
      width={28}
      height={28}
      unoptimized
      onLoad={() => {
        if (displayedSource === source) setStatus("loaded");
      }}
      onError={() => {
        if (displayedSource === source && source !== PLACEHOLDER_LOGO) setStatus("failed");
      }}
    />
  );
}
