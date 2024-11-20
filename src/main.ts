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

class GameState {
  private playerLocation: leaflet.LatLngTuple;
  private playerInventory: Array<Coin> = [];
  private caches = new Map<string, Cache>();
  private cacheLayer: leaflet.LayerGroup;
  private map: leaflet.Map;
  private playerMarker: leaflet.Marker;
  private path: leaflet.LatLngTuple[];
  private polyline: leaflet.Polyline;
  private statusPanel: HTMLDivElement;

  constructor() {
    document.title = CONFIG.APP_NAME;

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
    this.cacheLayer = leaflet.layerGroup().addTo(this.map);
    this.polyline = leaflet.polyline(this.path, { color: "red" }).addTo(
      this.map,
    );
    this.statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;

    this.updateStatusDisplay();
    this.setupControls();
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

  private initializePlayerMarker(): leaflet.Marker {
    const marker = leaflet.marker(this.playerLocation);
    marker.bindTooltip("This is you!");
    marker.addTo(this.map);
    return marker;
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
        this.movePlayer(lat, lon);
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
        this.resetGame();
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

    this.map.on(
      "locationfound",
      (e: { latlng: { lat: number; lng: number } }) => {
        this.playerLocation = [e.latlng.lat, e.latlng.lng];
        this.resetMap();
      },
    );
  }

  private movePlayer(lat: number, lon: number): void {
    for (const [key, cache] of this.caches.entries()) {
      this.saveCache(key, cache);
    }
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
    this.map.removeLayer(this.cacheLayer);
    this.caches.clear();
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
      const coinAmount = this.getCell(y, x).coins;

      const popup = document.createElement("div");
      popup.innerHTML = `
        <div>This cache has <span id="coin">${coinAmount.length}</span> coins.</div>
        <button id="collect">Collect</button>
        <button id="deposit">Deposit</button>
      `;

      popup.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
        "click",
        () => {
          this.updateCache(this.playerInventory, coinAmount);
          this.saveCache(this.getKey(y, x), this.getCell(y, x));
          popup.querySelector<HTMLSpanElement>("#coin")!.innerHTML =
            `${coinAmount.length}`;
        },
      );

      popup.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
        "click",
        () => {
          this.updateCache(coinAmount, this.playerInventory);
          this.saveCache(this.getKey(y, x), this.getCell(y, x));
          popup.querySelector<HTMLSpanElement>("#coin")!.innerHTML =
            `${coinAmount.length}`;
        },
      );

      return popup;
    });
  }

  private getCell(lat: number, lon: number): Cache {
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

  private updateStatusDisplay(): void {
    this.statusPanel.innerHTML =
      `You have ${this.playerInventory.length} coin(s)`;
  }

  private getKey(lat: number, lon: number): string {
    const i = Math.floor(lat * 100000);
    const j = Math.floor(lon * 100000);
    return `${i}:${j}`;
  }

  private updateCache(add: Array<Coin>, remove: Array<Coin>): void {
    if (remove.length > 0) {
      const coin = remove.pop()!;
      add.push(coin);
      this.updateStatusDisplay();
      localStorage.setItem("playerCoin", JSON.stringify(this.playerInventory));
    }
  }

  private saveCache(key: string, cache: Cache): void {
    localStorage.setItem(key, cache.toMomento());
  }

  private restoreCache(key: string): void {
    const momento = localStorage.getItem(key);
    if (momento) {
      const cache = new Cache([]);
      cache.fromMomento(momento);
      this.caches.set(key, cache);
    }
  }
}

// Initialize the game
new GameState();
