import { Game } from './core/Game';
import { SceneSystem } from './systems/SceneSystem';
import { InputSystem } from './systems/InputSystem';
import { CarSystem } from './systems/CarSystem';
import { WalkSystem } from './systems/WalkSystem';
import { CityBuilder } from './city/CityBuilder';
import { CloudSystem } from './systems/CloudSystem';
import { MinimapSystem } from './systems/MinimapSystem';
import { SpeedometerSystem } from './systems/SpeedometerSystem';

const GRID_X = 6;
const GRID_Z = 6;
const CITY_SEED = 42;
const CITY_CENTRE_X = 125;
const CITY_CENTRE_Z = 125;

const game = new Game();

// Systems are initialized in order — dependencies must come first
game
  .addSystem(new SceneSystem())
  .addSystem(new InputSystem())
  .addSystem(new CarSystem())        // 'car' — must come before WalkSystem
  .addSystem(new WalkSystem())       // 'player' — depends on CarSystem
  .addSystem(new CityBuilder(GRID_X, GRID_Z, CITY_SEED))
  .addSystem(new MinimapSystem())
  .addSystem(new SpeedometerSystem())
  .addSystem(new CloudSystem(CITY_CENTRE_X, CITY_CENTRE_Z))
  .start();
