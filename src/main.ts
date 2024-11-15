// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator (for non-spawn-related needs)
import luck from "./luck.ts";

const APP_NAME = "Geocoin Carrier";
document.title = APP_NAME;

// New coordinate system anchored at Null Island
const NULL_ISLAND = { lat: 0, lng: 0 };

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
}

// Cache data
interface Cache {
  cell: Cell;
  coins: Coin[];
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
  closePopupOnClick: false,
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
const defaultText = "No coins yet...";
statusPanel.innerHTML = defaultText;

const caches = new Map<Cell, Cache>();

// Look around the player's neighborhood for caches to spawn
const visibleCells = getVisibleCells(playerLocation);
visibleCells.forEach((cell) => {
  // Use Math.random() to randomly spawn caches
  if (Math.random() < CACHE_SPAWN_PROBABILITY) {
    spawnCache(cell);
  }
});

// --------------------------------- Functions ---------------------------------

// Get the surrounding cells of a given coordinate
function getVisibleCells(coord: { lat: number; lng: number }): Cell[] {
  const visibleCells: Cell[] = [];
  const offset = {
    i: Math.floor((coord.lat - NULL_ISLAND.lat) / TILE_DEGREES),
    j: Math.floor((coord.lng - NULL_ISLAND.lng) / TILE_DEGREES),
  };
  for (
    let i = offset.i - NEIGHBORHOOD_SIZE;
    i < offset.i + NEIGHBORHOOD_SIZE;
    i++
  ) {
    for (
      let j = offset.j - NEIGHBORHOOD_SIZE;
      j < offset.j + NEIGHBORHOOD_SIZE;
      j++
    ) {
      visibleCells.push({ i, j });
    }
  }
  return visibleCells;
}

// Add caches to the map by cell numbers
function spawnCache(cell: Cell) {
  let cache = caches.get(cell);
  if (!cache) {
    cache = { cell, coins: [] };
    generateCoins(cell, cache);
    caches.set(cell, cache);
  }

  const latLngBounds = leaflet.latLngBounds([
    [
      NULL_ISLAND.lat + cell.i * TILE_DEGREES,
      NULL_ISLAND.lng + cell.j * TILE_DEGREES,
    ],
    [
      NULL_ISLAND.lat + (cell.i + 1) * TILE_DEGREES,
      NULL_ISLAND.lng + (cell.j + 1) * TILE_DEGREES,
    ],
  ]);

  const rect = leaflet.rectangle(latLngBounds, { color: "blue", weight: 1 });
  rect.addTo(map);

  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    return updateCachePopup(popupDiv, cache);
  }, { keepInView: true });
}

// Generate coins for a cache
function generateCoins(cell: Cell, cache: Cache) {
  const numCoins = Math.floor(
    luck([cell.i, cell.j, "numCoins"].toString()) * 3 + 1,
  );
  for (let k = 0; k < numCoins; k++) {
    cache.coins.push({ cell, serial: k });
  }
}

// Collect a coin from a cache
function collect(coin: Coin, cache: Cache) {
  playerInventory.push(coin);
  const index = cache.coins.indexOf(coin);
  if (index > -1) cache.coins.splice(index, 1);
  displayInventory();
}

// Deposit all coins from the player's inventory into a cache
function deposit(cache: Cache) {
  while (playerInventory.length > 0) {
    const coin = playerInventory.pop();
    cache.coins.push(coin!);
  }
  displayInventory();
}

// Update the status panel with the player's inventory
function displayInventory() {
  let text = "";
  if (playerInventory.length > 0) {
    for (const coin of playerInventory) {
      text += `<ul><li>${coin.cell.i}:${coin.cell.j}#${coin.serial}</li></ul>`;
    }
  } else text = defaultText;
  statusPanel.innerHTML = text;
}

// Update the cache popup with the current cache contents
function updateCachePopup(popupDiv: HTMLElement, cache: Cache) {
  popupDiv.innerHTML =
    `<div>Cache ${cache.cell.i}:${cache.cell.j}<br><br>Inventory:<br></div>`;
  popupDiv.appendChild(updateCacheCoinDisplay(popupDiv, cache));

  const depositButton = document.createElement("button");
  depositButton.textContent = "Deposit Coins";
  depositButton.addEventListener("click", () => {
    deposit(cache);
    updateCachePopup(popupDiv, cache);
  });
  popupDiv.appendChild(depositButton);
  return popupDiv;
}

// Display the coins in the cache
function updateCacheCoinDisplay(popupDiv: HTMLElement, cache: Cache) {
  const cacheDiv = document.createElement("div");

  for (const coin of cache.coins) {
    const coinDiv = document.createElement("span");
    coinDiv.innerHTML =
      `<ul><li><span>${coin.cell.i}:${coin.cell.j}#${coin.serial}<span><button id="poke">Collect Coin</button></li></ul>`;
    coinDiv.querySelector<HTMLButtonElement>("#poke")!.addEventListener(
      "click",
      () => {
        collect(coin, cache);
        coinDiv.querySelector<HTMLButtonElement>("#poke")!.textContent =
          "Collected";
        coinDiv.querySelector<HTMLButtonElement>("#poke")!.disabled = true;
        updateCachePopup(popupDiv, cache);
      },
    );
    cacheDiv.appendChild(coinDiv);
  }
  return cacheDiv;
}
