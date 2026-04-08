import { Game } from './core/Game';
import { SceneSystem } from './systems/SceneSystem';
import { InputSystem } from './systems/InputSystem';
import { CarSystem } from './systems/CarSystem';
import { CityBuilder } from './city/CityBuilder';
import { CloudSystem } from './systems/CloudSystem';

const GRID_X = 12;
const GRID_Z = 12;
const CITY_SEED = 42;
// Approximate city centre — used to anchor cloud wrapping
const CITY_CENTRE_X = 250;
const CITY_CENTRE_Z = 250;

const game = new Game();

// Systems are initialized in order — dependencies must come first
game
  .addSystem(new SceneSystem())
  .addSystem(new InputSystem())
  .addSystem(new CarSystem())
  .addSystem(new CityBuilder(GRID_X, GRID_Z, CITY_SEED))
  .addSystem(new CloudSystem(CITY_CENTRE_X, CITY_CENTRE_Z))
  .start();
