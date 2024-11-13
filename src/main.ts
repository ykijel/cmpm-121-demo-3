// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
//import luck from "./luck.ts";

// Player variables
const playerLocation = leaflet.latLng(36.98949379578401, -122.06277128548504);
const playerInventory: Coin[] = [];

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// --------------------------------- Interfaces ---------------------------------

// Cell coordinates
interface Cell {
  i: number;
  j: number;
}

// Coin data
interface Coin {
  cell: Cell;
  serial: number;
  originCache: string; // Track where the coin came from
}

// Cache data
interface Cache {
  cell: Cell;
  coins: Coin[];
  popup: leaflet.Popup;
}
class Cache {
  cell: Cell;
  coins: Coin[] = [];

  constructor(cell: Cell) {
    this.cell = cell;
    // Generate a random number of coins for the cache (between 1 and 5)
    const numCoins = Math.floor(Math.random() * 5) + 1;

    // Add each coin to the cache
    for (let k = 0; k < numCoins; k++) {
      this.addCoin(spawnCoin(cell, k));
    }
  }

  displayCache() {
    const cacheDiv = document.createElement("div");

    for (const coin of this.coins) {
      const coinDiv = document.createElement("span");
      coinDiv.innerHTML = ` 
        <ul><li><span>${coin.cell.i}:${coin.cell.j}#${coin.serial}<span>
        <button id="poke">Collect Coin</button></li></ul>`;
      coinDiv
        .querySelector<HTMLButtonElement>("#poke")!
        .addEventListener("click", () => {
          collect(coin, this);
          // Disable the button after collecting
          coinDiv.querySelector<HTMLButtonElement>("#poke")!.textContent =
            "Collected";
          coinDiv.querySelector<HTMLButtonElement>("#poke")!.disabled = true;
        });
      cacheDiv.appendChild(coinDiv);
    }
    return cacheDiv;
  }

  addCoin(coin: Coin) {
    this.coins.push(coin);
  }

  removeCoin(coin: Coin) {
    const index = this.coins.indexOf(coin);
    if (index > -1) this.coins.splice(index, 1);
  }

  setPopup(popup: leaflet.Popup) {
    this.popup = popup;
  }
  openPopup() {
    this.popup.openPopup();
  }
}

// --------------------------------- Game Logic ---------------------------------

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: playerLocation,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(playerLocation);
playerMarker.bindTooltip("Your current location.");
playerMarker.addTo(map);

// Display the player's inventory using the status panel
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = "No coins yet...";

const caches = new Map<Cell, Cache>();

// Look around the player's neighborhood for caches to spawn
// Look around the player's neighborhood for caches to spawn
for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
    // Use Math.random() to decide if a cache should spawn, not luck function
    if (Math.random() < CACHE_SPAWN_PROBABILITY) {
      spawnCache({ i, j });
    }
  }
}

// --------------------------------- Functions ---------------------------------

// Add caches to the map by cell numbers
function spawnCache(cell: Cell) {
  // Generate the cache if it doesn't exist
  let cache = caches.get(cell);
  if (cache === undefined) {
    cache = new Cache(cell);
    caches.set(cell, cache);
  }

  // Convert cell numbers into lat/lng bounds
  const origin = playerLocation;
  const bounds = leaflet.latLngBounds([
    [origin.lat + cell.i * TILE_DEGREES, origin.lng + cell.j * TILE_DEGREES],
    [
      origin.lat + (cell.i + 1) * TILE_DEGREES,
      origin.lng + (cell.j + 1) * TILE_DEGREES,
    ],
  ]);

  // Add a rectangle to the map to represent the cache
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Handle interactions with the cache
  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `<div>Cache ${cell.i}:${cell.j}<br><br>
                          Inventory:<br></div>`;

    popupDiv.appendChild(cache.displayCache());

    // Add a deposit button
    const depositButton = document.createElement("button");
    depositButton.textContent = "Deposit Coins";
    depositButton.addEventListener("click", () => {
      deposit(cache);
    });
    popupDiv.appendChild(depositButton);

    return popupDiv;
  });

  cache.setPopup(rect.getPopup()!);
}

function spawnCoin(cell: Cell, serial: number) {
  const newCoin: Coin = { cell, serial, originCache: `${cell.i}:${cell.j}` }; // Track origin cache

  return newCoin;
}

function collect(coin: Coin, cache: Cache) {
  playerInventory.push(coin);
  cache.removeCoin(coin);
  displayInventory();
}

function deposit(cache: Cache) {
  while (playerInventory.length > 0) {
    const coin = playerInventory.pop();
    // Check if the coin can be deposited in the current cache (origin must match)
    cache.addCoin(coin!);
  }
  refreshPopup(cache);
  displayInventory();
}

function displayInventory() {
  let text = "";
  if (playerInventory.length > 0) {
    // Display the player's inventory in status panel
    for (const coin of playerInventory) {
      text += `<ul><li>${coin.cell.i}:${coin.cell.j}#${coin.serial}</li></ul>`;
    }
  }
  statusPanel.innerHTML = text;
}

function refreshPopup(cache: Cache) {
  if (cache.popup) {
    cache.popup.setContent(() => {
      const popupDiv = document.createElement("div");
      popupDiv.innerHTML = `<div>Cache ${cache.cell.i}:${cache.cell.j}<br><br>
                              Inventory:<br></div>`;

      // Create a new representation of the cache with the updated coins
      popupDiv.appendChild(cache.displayCache());

      // Reattach the deposit button
      const depositButton = document.createElement("button");
      depositButton.textContent = "Deposit Coins";
      depositButton.addEventListener("click", () => {
        deposit(cache);
      });
      popupDiv.appendChild(depositButton);

      return popupDiv;
    });
  }
}
