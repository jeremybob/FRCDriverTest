import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Gauge,
  Hexagon,
  MoveUpRight,
  Radio,
  Route,
  Target,
  Zap,
} from "lucide-react";
import type { RobotPreset, TestId } from "../types";
import { Venue } from "../render/venue";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Hexagon size={32} />
        <span>↗</span>
      </span>
      <div>
        DRIVER
        <span>
          LAB<span className="brand-dot"> / </span>FRC
        </span>
      </div>
    </div>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function TestIcon({ id, size = 24 }: { id: TestId; size?: number }) {
  const I = {
    T01: Target,
    T02: MoveUpRight,
    T03: Route,
    T04: Crosshair,
    T05: Gauge,
    T06: Zap,
  }[id];
  return <I size={size} strokeWidth={1.65} />;
}
export function RobotPreview({
  robot,
  className = "",
  interactive = false,
}: {
  robot: RobotPreset;
  className?: string;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ref.current) return;
    let venue: Venue | undefined;
    let raf = 0;
    let stopped = false;
    const canvas = ref.current;
    try {
      venue = new Venue(canvas, robot, "standard", true);
      const resize = new ResizeObserver(() => venue?.resize());
      resize.observe(canvas);
      venue
        .warm()
        .then(() => {
          if (stopped) return;
          const loop = (t: number) => {
            venue?.render(t);
            if (interactive) raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
        })
        .catch((e: unknown) => {
          if (!stopped)
            setError(
              e instanceof Error ? e.message : "Shader compilation failed",
            );
          venue?.dispose();
        });
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
        resize.disconnect();
        venue?.dispose();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL 2 unavailable");
      venue?.dispose();
    }
  }, [robot, interactive]);
  return (
    <div className={`robot-preview ${className}`}>
      <canvas
        ref={ref}
        aria-label={`${robot.name} detailed ${robot.kind} robot preview`}
      />
      {error && (
        <div className="render-error">
          <CircleHelp />
          <p>WebGL 2 is required to render the robot.</p>
          <small>{error}</small>
        </div>
      )}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="subtext">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Radio size={32} />
      <p>{children}</p>
    </div>
  );
}
export function LinkArrow() {
  return <ArrowUpRight size={19} />;
}
export function CardArrow() {
  return <ChevronRight size={18} />;
}
