"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  displayedTeamLogoSource,
  recoverTeamLogo,
  startTeamLogoLoadTimeout,
  TEAM_LOGO_PLACEHOLDER,
  type TeamLogoLoadStatus,
} from "@/lib/schedule/logo-load-timeout";

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
  const source = src.trim() || TEAM_LOGO_PLACEHOLDER;
  return <TeamLogoAttempt key={source} source={source} />;
}

function TeamLogoAttempt({ source }: { source: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [status, setStatus] = useState<TeamLogoLoadStatus>("loading");
  const [retrySource, setRetrySource] = useState<string | null>(null);
  const [alreadyRetried, setAlreadyRetried] = useState(false);
  const requestVersion = useRef(0);
  const activeSource = retrySource ?? source;
  const displayedSource = displayedTeamLogoSource(activeSource, TEAM_LOGO_PLACEHOLDER, nearViewport, status);

  const recoverCurrentRequest = useCallback(() => {
    requestVersion.current += 1;
    const recovery = recoverTeamLogo(source, alreadyRetried);
    if (recovery.kind === "retry") {
      setAlreadyRetried(true);
      setRetrySource(recovery.src);
      return;
    }
    setStatus("failed");
  }, [alreadyRetried, source]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    return observeNearViewport(image, () => setNearViewport(true));
  }, []);

  useEffect(() => {
    if (!nearViewport || status !== "loading" || activeSource === TEAM_LOGO_PLACEHOLDER) return;
    const version = ++requestVersion.current;
    return startTeamLogoLoadTimeout(() => {
      if (requestVersion.current === version) recoverCurrentRequest();
    });
  }, [activeSource, nearViewport, recoverCurrentRequest, status]);

  return (
    <Image
      ref={imageRef}
      key={displayedSource}
      src={displayedSource}
      alt=""
      width={28}
      height={28}
      unoptimized
      referrerPolicy="no-referrer"
      onLoad={() => {
        if (displayedSource === activeSource) {
          requestVersion.current += 1;
          setStatus("loaded");
        }
      }}
      onError={() => {
        if (displayedSource === activeSource && activeSource !== TEAM_LOGO_PLACEHOLDER) {
          recoverCurrentRequest();
        }
      }}
    />
  );
}

