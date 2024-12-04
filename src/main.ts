// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// Game configuration
const CONFIG = {
  APP_NAME: "GeoCoin Carrier",
  GAMEPLAY_ZOOM_LEVEL: 19,
  TILE_DEGREES: 1e-4,
  NEIGHBORHOOD_SIZE: 8,
  CACHE_SPAWN_PROBABILITY: 0.1,
  INITIAL_LOCATION: {
    lat: 36.989498,
    lng: -122.062777,
  },
} as const;

// Types and Interfaces
interface Coin {
  serial: string;
}

interface Momento<T> {
  toMomento(): T;
  fromMomento(momento: T): void;
}

class Cache implements Momento<string> {
  coins: Array<Coin>;

  constructor(coins: Array<Coin>) {
    this.coins = coins;
  }

  toMomento() {
    return JSON.stringify({ coins: this.coins });
  }

  fromMomento(momento: string) {
    const state = JSON.parse(momento);
    this.coins = state.coins;
  }
}

class CacheManager {
  private caches = new Map<string, Cache>();
  private map: leaflet.Map;
  private cacheLayer: leaflet.LayerGroup;
  private playerLocation: leaflet.LatLngTuple;
  private updateInventoryCallback: (inventory: Array<Coin>) => void;

  constructor(
    map: leaflet.Map,
    playerLocation: leaflet.LatLngTuple,
    updateInventoryCallback: (inventory: Array<Coin>) => void,
  ) {
    this.map = map;
    this.playerLocation = playerLocation;
    this.updateInventoryCallback = updateInventoryCallback;
    this.cacheLayer = leaflet.layerGroup().addTo(this.map);
  }

  populateNeighborhood(): void {
    this.cacheLayer = leaflet.layerGroup().addTo(this.map);
    for (
      let y = this.playerLocation[0] -
        CONFIG.TILE_DEGREES * CONFIG.NEIGHBORHOOD_SIZE;
      y <
        this.playerLocation[0] + CONFIG.TILE_DEGREES * CONFIG.NEIGHBORHOOD_SIZE;
      y += CONFIG.TILE_DEGREES
    ) {
      for (
        let x = this.playerLocation[1] -
          CONFIG.TILE_DEGREES * CONFIG.NEIGHBORHOOD_SIZE;
        x <
          this.playerLocation[1] +
            CONFIG.TILE_DEGREES * CONFIG.NEIGHBORHOOD_SIZE;
        x += CONFIG.TILE_DEGREES
      ) {
        if (luck([y, x].toString()) <= CONFIG.CACHE_SPAWN_PROBABILITY) {
          this.placeCache(y, x);
        }
      }
    }
  }

  private placeCache(y: number, x: number): void {
    const bounds = leaflet.latLngBounds(
      [y, x] as leaflet.LatLngTuple,
      [y + CONFIG.TILE_DEGREES, x + CONFIG.TILE_DEGREES] as leaflet.LatLngTuple,
    );

    const rect = leaflet.rectangle(bounds);
    rect.addTo(this.cacheLayer);

    rect.bindPopup(() => {
      this.restoreCache(this.getKey(y, x));
      const cachedCoins = this.getCell(y, x).coins;
      const playerInventory = JSON.parse(
        localStorage.getItem("playerCoin") || "[]",
      );

      const popup = document.createElement("div");
      popup.innerHTML = `
        <div>This cache has <span id="cache-coin">${cachedCoins.length}</span> coins.</div>
        <button id="collect">Collect</button>
        <button id="deposit">Deposit</button>
      `;

      popup.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
        "click",
        () => {
          // Move a coin from cache to player inventory
          const updatedPlayerInventory = this.updateCache(
            playerInventory,
            cachedCoins,
          );
          this.saveCache(this.getKey(y, x), this.getCell(y, x));
          this.updateInventoryCallback(updatedPlayerInventory);
          popup.querySelector<HTMLSpanElement>("#cache-coin")!.innerHTML =
            `${cachedCoins.length}`;
        },
      );

      popup.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
        "click",
        () => {
          // Move a coin from player inventory to cache
          const updatedPlayerInventory = this.updateCache(
            cachedCoins,
            playerInventory,
          );
          this.saveCache(this.getKey(y, x), this.getCell(y, x));
          this.updateInventoryCallback(updatedPlayerInventory);
          popup.querySelector<HTMLSpanElement>("#cache-coin")!.innerHTML =
            `${cachedCoins.length}`;
        },
      );

      return popup;
    });
  }

  private updateCache(
    targetInventory: Array<Coin>,
    sourceInventory: Array<Coin>,
  ): Array<Coin> {
    if (sourceInventory.length > 0) {
      const coin = sourceInventory.pop()!;
      targetInventory.push(coin);
      localStorage.setItem("playerCoin", JSON.stringify(targetInventory));
    }

    return targetInventory;
  }

  getCell(lat: number, lon: number): Cache {
    const key = this.getKey(lat, lon);

    let cache = this.caches.get(key);
    if (cache == undefined) {
      const coins = Array<Coin>();
      for (let i = 0; i < Math.floor(luck([lat, lon].toString()) * 100); i++) {
        coins.push({ serial: `${key}#${i}` });
      }
      cache = new Cache(coins);
      this.caches.set(key, cache);
    }

    return cache;
  }

  saveCache(key: string, cache: Cache): void {
    localStorage.setItem(key, cache.toMomento());
  }

  restoreCache(key: string): void {
    const momento = localStorage.getItem(key);
    if (momento) {
      const cache = new Cache([]);
      cache.fromMomento(momento);
      this.caches.set(key, cache);
    }
  }

  getKey(lat: number, lon: number): string {
    const i = Math.floor(lat * 100000);
    const j = Math.floor(lon * 100000);
    return `${i}:${j}`;
  }

  clearCaches(): void {
    this.caches.clear();
    this.cacheLayer.clearLayers();
  }

  updatePlayerLocation(location: leaflet.LatLngTuple): void {
    this.playerLocation = location;
  }
}

class UIController {
  private map: leaflet.Map;
  private statusPanel: HTMLDivElement;
  private updateLocationCallback: (lat: number, lon: number) => void;
  private resetGameCallback: () => void;

  constructor(
    map: leaflet.Map,
    statusPanel: HTMLDivElement,
    updateLocationCallback: (lat: number, lon: number) => void,
    resetGameCallback: () => void,
  ) {
    this.map = map;
    this.statusPanel = statusPanel;
    this.updateLocationCallback = updateLocationCallback;
    this.resetGameCallback = resetGameCallback;
    this.setupControls();
  }

  private setupControls(): void {
    this.setupMovementControls();
    this.setupResetButton();
    this.setupLocationSensor();
  }

  private setupMovementControls(): void {
    const directions = {
      north: [CONFIG.TILE_DEGREES, 0],
      east: [0, CONFIG.TILE_DEGREES],
      south: [-CONFIG.TILE_DEGREES, 0],
      west: [0, -CONFIG.TILE_DEGREES],
    } as const;

    Object.keys(directions).forEach((dir) => {
      const [lat, lon] = directions[dir as keyof typeof directions];
      const button = document.querySelector<HTMLButtonElement>(`#${dir}`)!;
      button.addEventListener("click", () => {
        this.updateLocationCallback(lat, lon);
      });
    });
  }

  private setupResetButton(): void {
    const reset = document.querySelector<HTMLButtonElement>("#reset")!;
    reset.addEventListener("click", () => {
      const confirm = prompt(
        "Reset back to start? (Yes/No)",
      );
      if (confirm === "Yes") {
        this.resetGameCallback();
      }
    });
  }

  private setupLocationSensor(): void {
    const sensor = document.querySelector<HTMLButtonElement>("#sensor")!;
    sensor.addEventListener("click", () => {
      if (sensor.classList.contains("locating")) {
        sensor.classList.remove("locating");
        this.map.stopLocate();
      } else {
        sensor.classList.add("locating");
        this.map.locate({ watch: true });
      }
    });
  }

  updateStatusDisplay(inventoryLength: number): void {
    this.statusPanel.innerHTML = `You have ${inventoryLength} coin(s)`;
  }
}

class GameState {
  private playerLocation: leaflet.LatLngTuple;
  private playerInventory: Array<Coin> = [];
  private map: leaflet.Map;
  private playerMarker: leaflet.Marker;
  private path: leaflet.LatLngTuple[];
  private polyline: leaflet.Polyline;
  private cacheManager: CacheManager;
  private uiController: UIController;
  private statusPanel: HTMLDivElement;

  constructor() {
    document.title = CONFIG.APP_NAME;
    this.statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;

    // Initialize player data
    const localPlayerData = localStorage.getItem("playerCoin");
    this.playerInventory = localPlayerData ? JSON.parse(localPlayerData) : [];

    // Initialize location
    const savedLocation = localStorage.getItem("playerLocation");
    this.playerLocation = savedLocation
      ? JSON.parse(savedLocation) as leaflet.LatLngTuple
      : [CONFIG.INITIAL_LOCATION.lat, CONFIG.INITIAL_LOCATION.lng];

    // Initialize path
    const savedPath = localStorage.getItem("savedPath");
    this.path = savedPath ? JSON.parse(savedPath) : [this.playerLocation];

    this.map = this.initializeMap();
    this.playerMarker = this.initializePlayerMarker();
    this.polyline = leaflet.polyline(this.path, { color: "red" }).addTo(
      this.map,
    );

    this.cacheManager = new CacheManager(
      this.map,
      this.playerLocation,
      this.updatePlayerInventory.bind(this),
    );

    this.uiController = new UIController(
      this.map,
      this.statusPanel,
      this.movePlayer.bind(this),
      this.resetGame.bind(this),
    );

    this.setupLocationEvents();
    this.updateStatusDisplay();
    this.populateNeighborhood();
  }

  private initializeMap(): leaflet.Map {
    const map = leaflet.map("map", {
      center: this.playerLocation,
      zoom: CONFIG.GAMEPLAY_ZOOM_LEVEL,
      scrollWheelZoom: false,
    });

    leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: CONFIG.GAMEPLAY_ZOOM_LEVEL,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    return map;
  }

  private setupLocationEvents(): void {
    this.map.on(
      "locationfound",
      (e: { latlng: { lat: number; lng: number } }) => {
        this.playerLocation = [e.latlng.lat, e.latlng.lng];
        this.resetMap();
      },
    );
  }

  private initializePlayerMarker(): leaflet.Marker {
    const marker = leaflet.marker(this.playerLocation);
    marker.bindTooltip("This is you!");
    marker.addTo(this.map);
    return marker;
  }

  private movePlayer(lat: number, lon: number): void {
    this.playerLocation = [
      this.playerLocation[0] + lat,
      this.playerLocation[1] + lon,
    ] as leaflet.LatLngTuple;

    localStorage.setItem("playerLocation", JSON.stringify(this.playerLocation));
    this.resetMap();
  }

  private resetMap(): void {
    this.path.push([...this.playerLocation]);
    localStorage.setItem("savedPath", JSON.stringify(this.path));
    this.polyline.setLatLngs(this.path);
    this.map.panTo(this.playerLocation);
    this.playerMarker.setLatLng(this.playerLocation);

    this.cacheManager.clearCaches();
    this.cacheManager.updatePlayerLocation(this.playerLocation);
    this.populateNeighborhood();
  }

  private resetGame(): void {
    this.playerInventory = [];
    this.updateStatusDisplay();
    this.playerLocation = [
      CONFIG.INITIAL_LOCATION.lat,
      CONFIG.INITIAL_LOCATION.lng,
    ];
    this.resetMap();
    if (this.polyline) {
      this.polyline.removeFrom(this.map);
    }
    this.path = [this.playerLocation];
    this.polyline = leaflet.polyline(this.path, { color: "red" }).addTo(
      this.map,
    );
    localStorage.clear();
  }

  private populateNeighborhood(): void {
    this.cacheManager.populateNeighborhood();
  }

  private updatePlayerInventory(inventory: Array<Coin>): void {
    this.playerInventory = inventory;
    this.updateStatusDisplay();
  }

  private updateStatusDisplay(): void {
    this.uiController.updateStatusDisplay(this.playerInventory.length);
  }
}

// Initialize the game
new GameState();
