import { Game } from './core/Game';
import { SceneSystem } from './systems/SceneSystem';
import { InputSystem } from './systems/InputSystem';
import { CarSystem } from './systems/CarSystem';
import { CityBuilder } from './city/CityBuilder';
import { CloudSystem } from './systems/CloudSystem';
import { MinimapSystem } from './systems/MinimapSystem';

const GRID_X = 6;
const GRID_Z = 6;
const CITY_SEED = 42;
// Approximate city centre — used to anchor cloud wrapping
const CITY_CENTRE_X = 125;
const CITY_CENTRE_Z = 125;

const game = new Game();

// Systems are initialized in order — dependencies must come first
game
  .addSystem(new SceneSystem())
  .addSystem(new InputSystem())
  .addSystem(new CarSystem())
  .addSystem(new CityBuilder(GRID_X, GRID_Z, CITY_SEED))
  .addSystem(new MinimapSystem())
  .addSystem(new CloudSystem(CITY_CENTRE_X, CITY_CENTRE_Z))
  .start();
