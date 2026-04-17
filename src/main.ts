import { Game } from './core/Game';
import { SceneSystem } from './systems/SceneSystem';
import { InputSystem } from './systems/InputSystem';
import { CarSystem } from './systems/CarSystem';
import { WalkSystem } from './systems/WalkSystem';
import { PedestrianSystem } from './systems/PedestrianSystem';
import { CityBuilder } from './city/CityBuilder';
import { DeliverySystem } from './systems/DeliverySystem';
import { CloudSystem } from './systems/CloudSystem';
import { MinimapSystem } from './systems/MinimapSystem';
import { SpeedometerSystem } from './systems/SpeedometerSystem';
import { TrafficSystem } from './systems/TrafficSystem';
import { SoundSystem } from './systems/SoundSystem';
import { NetworkSystem } from './systems/NetworkSystem';
import { RemotePlayerSystem } from './systems/RemotePlayerSystem';
import { showLobby } from './lobby';
import { CITY_GRID_X, CITY_GRID_Z, CITY_SEED, CITY_CENTRE_X, CITY_CENTRE_Z } from './constants';

(async () => {
  await showLobby();

  const game = new Game();

  // Systems are initialized in order — dependencies must come first
  game
    .addSystem(new SceneSystem())
    .addSystem(new InputSystem())
    .addSystem(new CarSystem())           // 'car' — must come before WalkSystem
    .addSystem(new WalkSystem())          // 'player' — depends on CarSystem
    .addSystem(new SoundSystem())         // depends on CarSystem + WalkSystem
    .addSystem(new NetworkSystem())       // 'network' — connects to server, relays events
    .addSystem(new RemotePlayerSystem())  // 'remote' — ghost meshes for other players
    .addSystem(new PedestrianSystem())
    .addSystem(new CityBuilder(CITY_GRID_X, CITY_GRID_Z, CITY_SEED))
    .addSystem(new DeliverySystem())      // 'delivery' — must come after CityBuilder and WalkSystem
    .addSystem(new MinimapSystem())
    .addSystem(new SpeedometerSystem())
    .addSystem(new TrafficSystem())       // 'traffic' — must come after CityBuilder
    .addSystem(new CloudSystem(CITY_CENTRE_X, CITY_CENTRE_Z))
    .start();
})();
