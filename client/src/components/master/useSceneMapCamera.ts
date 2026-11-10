import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  clampCamera,
  fitCamera,
  panBy,
  zoomAt,
  type GridCamera,
  type Point2D,
} from '../../combat/grid/gridCamera';

export function sceneInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"]',
      ),
    )
  );
}

/** Câmera local: reaproveita pan/zoom do combate e nunca altera coordenadas persistidas. */
export function useSceneMapCamera(
  root: RefObject<HTMLDivElement | null>,
  sceneKey: string,
  surfaceKey: string,
  ratio: number,
  suspended: boolean,
) {
  const [camera, updateCamera] = useState<GridCamera>({
    panX: 0,
    panY: 0,
    zoom: 1,
  });
  const cameraRef = useRef(camera);
  const viewport = useRef<HTMLDivElement | null>(null);
  const measured = useRef({ width: 0, height: 0 });
  const keys = useRef(new Set<string>());
  const frame = useRef<number | null>(null);
  const previousTime = useRef<number | null>(null);
  const fitted = useRef<string | null>(null);
  const stop = useCallback(() => {
    keys.current.clear();
    previousTime.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const world = useCallback(
    () => ({
      width: measured.current.width,
      height: measured.current.width * ratio,
    }),
    [ratio],
  );
  const setCamera = useCallback(
    (next: GridCamera) => {
      const value =
        measured.current.width > 0
          ? clampCamera(next, world(), measured.current)
          : next;
      cameraRef.current = value;
      updateCamera(value);
    },
    [world],
  );
  const pan = useCallback(
    (dx: number, dy: number) => setCamera(panBy(cameraRef.current, dx, dy)),
    [setCamera],
  );
  const zoom = useCallback(
    (delta: number, anchor?: Point2D) => {
      const current = cameraRef.current;
      const factor = Math.max(0.05, current.zoom + delta) / current.zoom;
      setCamera(
        zoomAt(
          current,
          factor,
          anchor ?? {
            x: measured.current.width / 2,
            y: measured.current.height / 2,
          },
        ),
      );
    },
    [setCamera],
  );
  const fit = useCallback(() => {
    setCamera(
      measured.current.width > 0
        ? fitCamera({ scene: world(), viewport: measured.current })
        : { panX: 0, panY: 0, zoom: 1 },
    );
  }, [setCamera, world]);

  useLayoutEffect(() => {
    const node = root.current?.querySelector<HTMLDivElement>(
      '.scene-wall-viewport',
    );
    if (!node) return;
    viewport.current = node;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const width = node.clientWidth || rect.width;
      const height = node.clientHeight || rect.height;
      if (!(width > 0 && height > 0)) return;
      measured.current = { width, height };
      if (fitted.current !== sceneKey) {
        fitted.current = sceneKey;
        fit();
      } else setCamera(cameraRef.current);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (suspended) return;
      const rect = node.getBoundingClientRect();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      setCamera(
        zoomAt(
          cameraRef.current,
          Math.exp(-Math.max(-600, Math.min(600, delta)) * 0.0015),
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
        ),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(node);
    window.addEventListener('resize', measure);
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      node.removeEventListener('wheel', wheel);
      viewport.current = null;
    };
  }, [root, sceneKey, surfaceKey, fit, setCamera, suspended]);

  useLayoutEffect(() => {
    const up = (event: globalThis.KeyboardEvent) => {
      keys.current.delete(event.code);
      if (keys.current.size === 0) stop();
    };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [stop]);
  useLayoutEffect(() => {
    if (suspended) stop();
  }, [suspended, stop]);

  function keyDown(event: KeyboardEvent) {
    if (
      suspended ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      sceneInputTarget(event.target) ||
      !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    keys.current.add(event.code);
    if (frame.current !== null) return;
    const tick = (now: number) => {
      const dt =
        previousTime.current === null
          ? 1 / 60
          : Math.min(0.04, (now - previousTime.current) / 1000);
      previousTime.current = now;
      const dx =
        Number(keys.current.has('KeyA')) - Number(keys.current.has('KeyD'));
      const dy =
        Number(keys.current.has('KeyW')) - Number(keys.current.has('KeyS'));
      const length = Math.hypot(dx, dy) || 1;
      pan((dx / length) * 600 * dt, (dy / length) * 600 * dt);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  return { camera, pan, zoom, fit, stop, keyDown, viewport };
}
