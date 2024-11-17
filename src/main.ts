// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import luck from "./luck.ts";

// Game configuration
const CONFIG = {
  APP_NAME: "Geocoin Carrier",
  GAMEPLAY_ZOOM_LEVEL: 19,
  TILE_DEGREES: 1e-4,
  NEIGHBORHOOD_SIZE: 8,
  CACHE_SPAWN_PROBABILITY: 0.1,
  INITIAL_LOCATION: {
    lat: 36.98949379578401,
    lng: -122.06277128548504,
  },
} as const;

// Types
interface Cell {
  i: number;
  j: number;
}

interface Coin {
  cell: Cell;
  serial: number;
}

interface Cache {
  cell: Cell;
  coins: Coin[];
}

interface MoveDirection {
  dx: number;
  dy: number;
}

interface MoveButtons {
  up: MoveDirection;
  down: MoveDirection;
  left: MoveDirection;
  right: MoveDirection;
}

class GameState {
  private playerLocation: leaflet.LatLng;
  private playerInventory: Coin[] = [];
  private caches = new Map<string, string>();
  private cacheMarkers = new Map<string, leaflet.Rectangle>();
  private map: leaflet.Map;
  private playerMarker: leaflet.Marker;
  private statusPanel: HTMLDivElement;

  constructor() {
    this.playerLocation = leaflet.latLng(
      CONFIG.INITIAL_LOCATION.lat,
      CONFIG.INITIAL_LOCATION.lng,
    );
    document.title = CONFIG.APP_NAME;

    this.map = this.initializeMap();
    this.playerMarker = this.initializePlayerMarker();
    this.statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;

    this.initializeStartingCaches();
    this.setupControls();
  }

  private initializeMap(): leaflet.Map {
    const map = leaflet.map(document.getElementById("map")!, {
      center: this.playerLocation,
      zoom: CONFIG.GAMEPLAY_ZOOM_LEVEL,
      minZoom: CONFIG.GAMEPLAY_ZOOM_LEVEL,
      maxZoom: CONFIG.GAMEPLAY_ZOOM_LEVEL,
      zoomControl: false,
      scrollWheelZoom: false,
      closePopupOnClick: false,
    });

    leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    return map;
  }

  private initializePlayerMarker(): leaflet.Marker {
    const marker = leaflet.marker(this.playerLocation);
    marker.bindTooltip("Your current location.");
    marker.addTo(this.map);
    return marker;
  }

  private initializeStartingCaches(): void {
    const cells = this.getVisibleCells(this.playerLocation);
    for (let i = 0; i < cells.length; i++) {
      if (
        luck([cells[i].i, cells[i].j].toString()) <
          CONFIG.CACHE_SPAWN_PROBABILITY
      ) {
        this.spawnCache(cells[i]);
      }
    }
  }

  private setupControls(): void {
    const moveButtons: MoveButtons = {
      up: { dx: CONFIG.TILE_DEGREES, dy: 0 },
      down: { dx: -CONFIG.TILE_DEGREES, dy: 0 },
      left: { dx: 0, dy: -CONFIG.TILE_DEGREES },
      right: { dx: 0, dy: CONFIG.TILE_DEGREES },
    };

    // Using a traditional for...in loop instead of Object.entries
    for (const direction in moveButtons) {
      const delta = moveButtons[direction as keyof MoveButtons];
      const buttonId = `#move${direction.charAt(0).toUpperCase()}${
        direction.slice(1)
      }`;
      const button = document.querySelector<HTMLButtonElement>(buttonId);
      if (button) {
        button.addEventListener("click", () => {
          this.movePlayer({
            i: this.playerLocation.lat + delta.dx,
            j: this.playerLocation.lng + delta.dy,
          });
        });
      }
    }
  }

  private movePlayer(newPos: Cell): void {
    this.playerLocation.lat = newPos.i;
    this.playerLocation.lng = newPos.j;
    this.playerMarker.setLatLng(this.playerLocation);
    this.map.panTo(this.playerLocation);
    this.updateCaches();
  }

  private getVisibleCells(coord: { lat: number; lng: number }): Cell[] {
    const cells: Cell[] = [];
    const offset = {
      i: Math.floor(coord.lat / CONFIG.TILE_DEGREES),
      j: Math.floor(coord.lng / CONFIG.TILE_DEGREES),
    };

    for (
      let di = -CONFIG.NEIGHBORHOOD_SIZE;
      di < CONFIG.NEIGHBORHOOD_SIZE;
      di++
    ) {
      for (
        let dj = -CONFIG.NEIGHBORHOOD_SIZE;
        dj < CONFIG.NEIGHBORHOOD_SIZE;
        dj++
      ) {
        cells.push({
          i: offset.i + di,
          j: offset.j + dj,
        });
      }
    }

    return cells;
  }

  private spawnCache(cell: Cell): void {
    const cellString = this.cellToString(cell);
    const cache: Cache = this.caches.has(cellString)
      ? JSON.parse(this.caches.get(cellString)!)
      : this.generateNewCache(cell);

    const bounds = leaflet.latLngBounds([
      [cell.i * CONFIG.TILE_DEGREES, cell.j * CONFIG.TILE_DEGREES],
      [(cell.i + 1) * CONFIG.TILE_DEGREES, (cell.j + 1) * CONFIG.TILE_DEGREES],
    ]);

    const rect = leaflet.rectangle(bounds);
    rect.addTo(this.map);
    rect.bindPopup(() => this.createCachePopup(cache), { keepInView: true });

    this.cacheMarkers.set(cellString, rect);
  }

  private generateNewCache(cell: Cell): Cache {
    const cache: Cache = { cell, coins: [] };
    const numCoins = Math.floor(
      luck([cell.i, cell.j, "numCoins"].toString()) * 3 + 1,
    );

    for (let k = 0; k < numCoins; k++) {
      cache.coins.push({ cell, serial: k });
    }

    this.caches.set(this.cellToString(cell), JSON.stringify(cache));
    return cache;
  }

  private createCachePopup(cache: Cache): HTMLElement {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML =
      `<div>Cache ${cache.cell.i}:${cache.cell.j}<br><br>Inventory:<br></div>`;

    const coinsDiv = document.createElement("div");
    cache.coins.forEach((coin) => {
      const coinDiv = document.createElement("div");
      coinDiv.innerHTML = `
        <ul><li>
          <span>${coin.cell.i}:${coin.cell.j}#${coin.serial}</span>
          <button id="collect-${coin.serial}">Collect Coin</button>
        </li></ul>`;

      const button = coinDiv.querySelector(`#collect-${coin.serial}`);
      if (button) {
        button.addEventListener("click", (e) => {
          this.collectCoin(coin, cache);
          const target = e.target as HTMLButtonElement;
          target.textContent = "Collected";
          target.disabled = true;
          popupDiv.replaceWith(this.createCachePopup(cache));
        });
      }

      coinsDiv.appendChild(coinDiv);
    });

    const depositButton = document.createElement("button");
    depositButton.textContent = "Deposit Coins";
    depositButton.addEventListener("click", () => {
      this.depositCoins(cache);
      popupDiv.replaceWith(this.createCachePopup(cache));
    });

    popupDiv.appendChild(coinsDiv);
    popupDiv.appendChild(depositButton);
    return popupDiv;
  }

  private collectCoin(coin: Coin, cache: Cache): void {
    this.playerInventory.push(coin);
    cache.coins = cache.coins.filter((c) => c !== coin);
    this.caches.set(this.cellToString(cache.cell), JSON.stringify(cache));
    this.updateInventoryDisplay();
  }

  private depositCoins(cache: Cache): void {
    cache.coins.push(...this.playerInventory);
    this.playerInventory = [];
    this.caches.set(this.cellToString(cache.cell), JSON.stringify(cache));
    this.updateInventoryDisplay();
  }

  private updateCaches(): void {
    const visibleCells = this.getVisibleCells(this.playerLocation);
    const visibleCellStrings = new Set(
      visibleCells.map((cell) => this.cellToString(cell)),
    );

    // Remove out-of-view caches
    for (const [cellString, marker] of this.cacheMarkers) {
      if (!visibleCellStrings.has(cellString)) {
        marker.remove();
        this.cacheMarkers.delete(cellString);
      }
    }

    // Spawn new caches
    visibleCells.forEach((cell) => {
      const cellString = this.cellToString(cell);
      if (
        !this.cacheMarkers.has(cellString) &&
        luck([cell.i, cell.j].toString()) < CONFIG.CACHE_SPAWN_PROBABILITY
      ) {
        this.spawnCache(cell);
      }
    });
  }

  private updateInventoryDisplay(): void {
    if (this.playerInventory.length === 0) {
      this.statusPanel.innerHTML = "No coins yet...";
      return;
    }

    const items = this.playerInventory.map(
      (coin) =>
        `<ul><li>${coin.cell.i}:${coin.cell.j}#${coin.serial}</li></ul>`,
    );
    this.statusPanel.innerHTML = items.join("");
  }

  private cellToString(cell: Cell): string {
    return `${cell.i},${cell.j}`;
  }
}

// Initialize the game
new GameState();
