import { Game } from './core/Game';
import { SceneSystem } from './systems/SceneSystem';
import { InputSystem } from './systems/InputSystem';
import { CarSystem } from './systems/CarSystem';
import { WalkSystem } from './systems/WalkSystem';
import { CityBuilder } from './city/CityBuilder';
import { CloudSystem } from './systems/CloudSystem';
import { MinimapSystem } from './systems/MinimapSystem';
import { SpeedometerSystem } from './systems/SpeedometerSystem';
import { CITY_GRID_X, CITY_GRID_Z, CITY_SEED, CITY_CENTRE_X, CITY_CENTRE_Z } from './constants';

const game = new Game();

// Systems are initialized in order — dependencies must come first
game
  .addSystem(new SceneSystem())
  .addSystem(new InputSystem())
  .addSystem(new CarSystem())        // 'car' — must come before WalkSystem
  .addSystem(new WalkSystem())       // 'player' — depends on CarSystem
  .addSystem(new CityBuilder(CITY_GRID_X, CITY_GRID_Z, CITY_SEED))
  .addSystem(new MinimapSystem())
  .addSystem(new SpeedometerSystem())
  .addSystem(new CloudSystem(CITY_CENTRE_X, CITY_CENTRE_Z))
  .start();
