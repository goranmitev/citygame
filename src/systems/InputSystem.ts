import { Game, GameSystem } from '../core/Game';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  mouseDX: number;
  mouseDY: number;
  pointerLocked: boolean;
}

/**
 * Handles keyboard, mouse, and touch input.
 * Manages pointer lock on desktop, virtual joystick on mobile.
 */
export class InputSystem implements GameSystem {
  readonly name = 'input';
  readonly state: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    mouseDX: 0,
    mouseDY: 0,
    pointerLocked: false,
  };

  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLElement;

  // Touch controls
  private touchMoveId: number | null = null;
  private touchLookId: number | null = null;
  private touchMoveStart = { x: 0, y: 0 };
  private touchLookPrev = { x: 0, y: 0 };
  private isMobile = false;

  init(game: Game): void {
    this.canvas = game.renderer.domElement;
    this.overlay = document.getElementById('overlay')!;
    this.isMobile = 'ontouchstart' in window;

    // Keyboard
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Mouse
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    // Click to lock pointer (desktop) or dismiss overlay (mobile)
    this.overlay.addEventListener('click', () => {
      if (this.isMobile) {
        this.overlay.classList.add('hidden');
        this.state.pointerLocked = true; // treat as "active" on mobile
      } else {
        this.canvas.requestPointerLock();
      }
    });

    // Touch
    if (this.isMobile) {
      this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
      this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
      this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
    }
  }

  /** Call at end of each frame to reset per-frame deltas. */
  resetDeltas(): void {
    this.state.mouseDX = 0;
    this.state.mouseDY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
  }

  // --- Keyboard ---

  private onKeyDown = (e: KeyboardEvent): void => {
    this.mapKey(e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.mapKey(e.code, false);
  };

  private mapKey(code: string, down: boolean): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.state.forward = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.state.backward = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.state.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.state.right = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.state.sprint = down;
        break;
    }
  }

  // --- Mouse ---

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.state.pointerLocked) return;
    this.state.mouseDX += e.movementX;
    this.state.mouseDY += e.movementY;
  };

  private onPointerLockChange = (): void => {
    this.state.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.state.pointerLocked) {
      this.overlay.classList.add('hidden');
    } else {
      this.overlay.classList.remove('hidden');
      // Reset movement keys on unlock
      this.state.forward = this.state.backward = this.state.left = this.state.right = false;
    }
  };

  // --- Touch ---

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    const w = window.innerWidth;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientX < w / 2 && this.touchMoveId === null) {
        // Left half: movement
        this.touchMoveId = t.identifier;
        this.touchMoveStart = { x: t.clientX, y: t.clientY };
      } else if (t.clientX >= w / 2 && this.touchLookId === null) {
        // Right half: look
        this.touchLookId = t.identifier;
        this.touchLookPrev = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (t.identifier === this.touchMoveId) {
        const dx = t.clientX - this.touchMoveStart.x;
        const dy = t.clientY - this.touchMoveStart.y;
        const deadzone = 15;
        this.state.forward = dy < -deadzone;
        this.state.backward = dy > deadzone;
        this.state.left = dx < -deadzone;
        this.state.right = dx > deadzone;
      }

      if (t.identifier === this.touchLookId) {
        this.state.mouseDX += (t.clientX - this.touchLookPrev.x) * 2;
        this.state.mouseDY += (t.clientY - this.touchLookPrev.y) * 2;
        this.touchLookPrev = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.touchMoveId) {
        this.touchMoveId = null;
        this.state.forward = this.state.backward = this.state.left = this.state.right = false;
      }
      if (t.identifier === this.touchLookId) {
        this.touchLookId = null;
      }
    }
  };
}
