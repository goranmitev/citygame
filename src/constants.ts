// =============================================================================
// Game-wide constants — all magic numbers live here.
// Import what you need; never hardcode values in system files.
// =============================================================================

// --- City generation ---
export const CITY_GRID_X = 6;
export const CITY_GRID_Z = 6;
export const CITY_SEED = 42;
export const CITY_CENTRE_X = 350;
export const CITY_CENTRE_Z = 350;

// --- City colors ---
export const ROAD_COLOR = 0x6b6b6b;
export const SIDEWALK_COLOR = 0x999990;
export const GROUND_COLOR = 0x4a5a3a;
export const MARKING_COLOR = 0xccccaa;

// --- Car physics (scaled for Meshy model; 20% smaller visual per request) ---
export const CAR_HALF_W = 4.0;         // half-width for collision
export const CAR_HALF_L = 8.8;         // half-length for collision
export const CAR_HEIGHT = 3.2;         // collision box height
export const CAR_MAX_SPEED_FWD = 22;   // m/s (~80 km/h)
export const CAR_MAX_SPEED_REV = 6;
export const CAR_ACCEL = 14;           // m/s² while throttle pressed
export const CAR_BRAKE_FORCE = 20;     // m/s² while braking
export const CAR_DRAG = 10;            // passive deceleration when no input
export const CAR_STEER_SPEED = 3.2;    // rad/s max turn rate at low speed
export const CAR_SPEED_STEER_FACTOR = 0.03; // reduces steering at high speed
export const CAR_MIN_TURN_SPEED = 0.3;  // m/s below which car cannot turn (no spinning in place)
export const CAR_FULL_TURN_SPEED = 6;   // m/s at which full turn rate is reached (ramps up from min)

// --- Car visuals (Meshy GLB) ---
export const CAR_MODEL_SCALE = 2.4;
export const CAR_GROUND_CLEARANCE = 0; // tuned lower for flush ground contact
export const CAR_BODY_ROUGHNESS = 0.65; // less shiny
export const CAR_BODY_METALNESS = 0.55;
export const CAR_ENV_INTENSITY = 1.2; // brighter

// --- Car camera ---
export const CAR_CAM_DIST = 9;
export const CAR_CAM_HEIGHT = 3.5;
export const CAR_CAM_LERP = 8;
export const CAR_MOUSE_SENSITIVITY = 0.003;
export const CAR_PITCH_MIN = -0.3;
export const CAR_PITCH_MAX = 0.6;

// --- Walk physics ---
export const WALK_SPEED = 5;           // m/s
export const SPRINT_SPEED = 9;         // m/s
export const PLAYER_RADIUS = 0.3;      // collision cylinder radius
export const PLAYER_HEIGHT = 1.75;

// --- Walk camera ---
export const WALK_CAM_DIST = 5;
export const WALK_CAM_HEIGHT = 2.0;
export const WALK_CAM_LERP = 10;
export const WALK_MOUSE_SENSITIVITY = 0.003;
export const WALK_PITCH_MIN = -0.4;
export const WALK_PITCH_MAX = 0.8;

// --- Enter/exit car ---
export const CAR_ENTER_RADIUS = 8.0;   // increased for larger car (prevents trapping)

// --- Minimap ---
export const MAP_SIZE = 180;
export const MAP_PADDING = 35;
export const MAP_DOT_RADIUS = 4;
export const MAP_ARROW_SIZE = 7;

// --- Speedometer ---
export const SPEEDO_SIZE = 120;        // canvas px
export const SPEEDO_PADDING = 10;      // px from corner
export const SPEEDO_MAX_SPEED = 160;   // km/h — full dial

// --- Delivery game ---
export const DELIVERY_RESTAURANT_COUNT = 6;
export const DELIVERY_INTERACT_RADIUS = 3.5;
export const DELIVERY_MAX_FAILURES = 5;
export const DELIVERY_BASE_PAY = 0.10;         // 10% of order value
export const DELIVERY_MAX_TIP = 0.30;          // up to 30% tip for fast delivery
export const DELIVERY_ORDER_VALUE_MIN = 20;
export const DELIVERY_ORDER_VALUE_MAX = 80;
export const DELIVERY_TIME_BASE = 40;          // base seconds on timer
export const DELIVERY_TIME_PER_UNIT = 0.085;   // extra seconds per world-unit of distance
export const DELIVERY_ORDER_INTERVAL_MIN = 10; // seconds between new order spawns
export const DELIVERY_ORDER_INTERVAL_MAX = 25;
export const DELIVERY_NEXT_ORDER_DELAY = 4;    // seconds until next spawn after delivery/fail

// --- Clouds ---
export const CLOUD_COUNT = 40;
export const CLOUD_MIN_Y = 70;
export const CLOUD_MAX_Y = 130;
export const CLOUD_DRIFT_SPEED = 3.0;  // world units / second
export const CLOUD_DRIFT_DIR_X = 1.0;
export const CLOUD_DRIFT_DIR_Z = 0.25;
export const SPRITES_PER_CLOUD = 5;
export const SPRITE_MIN_SIZE = 30;
export const SPRITE_MAX_SIZE = 60;
export const CLOUD_SPREAD_X = 30;
export const CLOUD_SPREAD_Z = 12;
export const CLOUD_FIELD_HALF = 420;   // wrap boundary around city centre
