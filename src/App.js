import "./App.css";
import React, { useEffect, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  Marker,
  Popup,
  Polyline,
  useMap,
  CircleMarker,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

import L from "leaflet";
delete L.Icon.Default.prototype._getIconUrl;

const R = 6371;

/**
 * Calculates the great-circle distance between two points
 * using the Haversine formula.
 * @param {number} lat1 Latitude of point 1
 * @param {number} lon1 Longitude of point 1
 * @param {number} lat2 Latitude of point 2
 * @param {number} lon2 Longitude of point 2
 * @returns {number} Distance in kilometers.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetches balloon data for a specific hour.
 * @param {number} hour - The hour offset (0 for current, 1 for 1 hour ago, etc.).
 * @param {object} allBalloonHistories - The object to store fetched data.
 * @returns {Promise<boolean>} - Promise resolving to true if any fetch/parse error occurred, false otherwise.
 */
async function fetchHourlyData(hour, allBalloonHistories) {
  const hourString = hour.toString().padStart(2, "0");
  
  const url = `/api/treasure/${hourString}.json`; 
  
  const isCurrentHour = hour === 0;
  const fetchTimeout = isCurrentHour ? 20000 : 10000;

  try {
    const controller = typeof AbortController !== "undefined"
      ? new AbortController()
      : { signal: null, abort: () => {} };
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

    const response = await fetch(url, { signal: controller.signal })
      .finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      console.warn(`Failed to fetch data for hour ${hourString}: ${response.statusText}`);
      return true;
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.warn(`Corrupted JSON data for hour ${hourString}:`, parseError);
      return true;
    }

    if (data && Array.isArray(data)) {
      data.forEach((balloonData, index) => {
        try {
          if (!balloonData || !Array.isArray(balloonData) || balloonData.length < 3) return;
          const [lat, lon, alt] = balloonData;
          if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0 && alt === 0)) return;

          const id = String(index);
          if (!allBalloonHistories[id]) {
            allBalloonHistories[id] = { positions: [], totalDistance: 0 };
          }
          const timestamp = new Date(Date.now() - hour * 60 * 60 * 1000);
          allBalloonHistories[id].positions.push({ lat, lon, alt: typeof alt === "number" ? alt : 0, timestamp, hour });
        } catch (balloonError) {
          console.warn(`Error processing balloon data entry for hour ${hourString}, index ${index}:`, balloonError);
        }
      });
    }
  } catch (fetchHourError) {
    console.warn(`Error fetching or processing data for hour ${hourString}:`, fetchHourError);
    return true;
  }
  return false;
}

/**
 * Fetches and processes balloon data, including calculating distances.
 * @param {Function} setBalloons - State setter for balloon data.
 * @param {Function} setLoading - State setter for loading status.
 * @param {Function} setError - State setter for error messages.
 * @param {Function} setLastRefreshed - State setter for the last refresh time.
 */
async function fetchAndProcessBalloonData(setBalloons, setLoading, setError, setLastRefreshed) {
  setLoading(true);
  setError(null);
  const allBalloonHistories = {};
  let overallFetchError = false;

  try {
    const fetchPromises = [];
    for (let i = 0; i <= 23; i++) {
      fetchPromises.push(fetchHourlyData(i, allBalloonHistories));
    }
    const results = await Promise.all(fetchPromises);
    overallFetchError = results.some(errorOccurred => errorOccurred);

    let maxDistance = 0;
    let totalDistanceAllBalloons = 0;

    const balloonArray = Object.keys(allBalloonHistories).map((id) => {
      const history = allBalloonHistories[id];
      history.positions.sort((a, b) => a.hour - b.hour || b.timestamp - a.timestamp);

      let balloonDistance = 0;
      for (let j = 1; j < history.positions.length; j++) {
          const pos1 = history.positions[j-1];
          const pos2 = history.positions[j];
          const segmentDist = calculateDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
          if (Math.abs(pos1.lon - pos2.lon) < 180 && segmentDist < 2000) { // Heuristic limit: 2000km/hr seems unlikely
             balloonDistance += segmentDist;
          }
      }
      history.totalDistance = balloonDistance;
      totalDistanceAllBalloons += balloonDistance;
      if (balloonDistance > maxDistance) {
          maxDistance = balloonDistance;
      }

      history.positions.sort((a, b) => b.timestamp - a.timestamp);

      return {
        id,
        positions: history.positions,
        currentPosition: history.positions.length > 0 ? history.positions[0] : null,
        totalDistance: history.totalDistance,
      };
    });

    const validBalloons = balloonArray.filter(b => b.positions.length > 0 && b.currentPosition);

    const processedBalloons = validBalloons.map(b => ({ ...b, maxDistance }));

    setBalloons(processedBalloons);
    setLastRefreshed(new Date());

    if (overallFetchError) {
      setError("Data refreshed, but some hourly data might be missing.");
    } else {
      setError(null);
    }
  } catch (err) {
    console.error("An unexpected error occurred during fetchAndProcessBalloonData:", err);
    setError("Failed to load balloon data due to an unexpected error.");
    setBalloons([]);
  } finally {
    setLoading(false);
  }
}

/**
 * Splits a list of balloon positions into segments for antimeridian crossing.
 * @param {Array<object>} positions - Array of position objects {lat, lon, ...}.
 * @returns {Array<Array<[number, number]>>} - Array of path segments [[lat, lon], ...].
 */
function splitPathSegments(positions) {
  const segments = [];
  let currentSegment = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const latLon = [pos.lat, pos.lon];

    if (i > 0) {
      const prevLon = positions[i - 1].lon;
      const currentLon = pos.lon;
      if (Math.abs(currentLon - prevLon) > 180) {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
        }
        currentSegment = [latLon];
      } else {
         currentSegment.push(latLon);
      }
    } else {
        currentSegment.push(latLon);
    }
  }
  if (currentSegment.length > 1) {
    segments.push(currentSegment);
  }
  return segments;
}

/**
 * Renders the map reset button.
/**
 * Renders the map reset button.
 */
function MapController() {
  const map = useMap();
  return (
    <div
      className="reset-view-button"
      onClick={() => map.setView([0, 0], 1.5)}
      onKeyPress={(e) => e.key === "Enter" && map.setView([0, 0], 1.5)}
      role="button"
      aria-label="Reset map to global view"
      tabIndex="0"
    >
      <span>Reset Map View</span>
    </div>
  );
}

/**
 * Renders a balloon's current position marker and popup.
 * @param {{ balloon: object, markerColor: string }} props
 */
function BalloonMarker({ balloon, markerColor }) {
  if (!balloon.currentPosition) return null;

  return (
    <CircleMarker
      center={[balloon.currentPosition.lat, balloon.currentPosition.lon]}
      pathOptions={{ color: markerColor, fillColor: markerColor, fillOpacity: 0.8, weight: 1 }}
      radius={5}
    >
      <Popup>
        <div className="balloon-popup">
          <h3>Balloon #{balloon.id}</h3>
          <p>Lat: {balloon.currentPosition.lat.toFixed(4)}</p>
          <p>Lon: {balloon.currentPosition.lon.toFixed(4)}</p>
          <p>Alt: {balloon.currentPosition.alt.toFixed(2)} km</p>
          <p>FL: {Math.max(0, Math.round((balloon.currentPosition.alt * 3.28084) / 100)).toString().padStart(3, "0")}</p>
          <p>Dist (24h): {balloon.totalDistance ? balloon.totalDistance.toFixed(0) : 'N/A'} km</p>
          <p>
            Last updated: <br />
            <span className="timestamp">{balloon.currentPosition.timestamp.toLocaleString()}</span>
          </p>
        </div>
      </Popup>
    </CircleMarker>
  );
}

/**
 * Renders the flight path segments for a balloon, colored by distance (Blue < Avg < Red).
 * @param {{
 *   balloonId: string,
 *   segments: Array<Array<[number, number]>>,
 *   totalDistance: number,
 *   maxDistance: number,
 *   averageDistance: number
 * }} props
 */
function BalloonPath({ balloonId, segments, totalDistance, maxDistance, averageDistance }) {
   let hue;
   const saturation = 80;
   const lightness = 50;

   if (averageDistance <= 0) {
      // Handle edge case where average is zero or less
      hue = 120; // Default to Green
   } else if (totalDistance <= averageDistance) {
      // Below or equal to average: Interpolate Blue (240) to Green (120)
      const ratio = totalDistance / averageDistance; // Ratio will be 0 (at 0 dist) to 1 (at avg dist)
      hue = 240 - ratio * (240 - 120);
   } else {
      // Above average: Interpolate Green (120) to Red (0)
      const rangeAboveAverage = maxDistance - averageDistance;
      if (rangeAboveAverage <= 0) {
        // Handle edge case where max is not greater than average
        hue = 120; // Stick to Green if no range above average
      } else {
        const distanceAboveAverage = totalDistance - averageDistance;
        // Ratio will be 0 (at avg dist) to 1 (at max dist), clamped at 1
        const ratio = Math.min(distanceAboveAverage / rangeAboveAverage, 1);
        hue = 120 - ratio * 120;
      }
   }

   const pathColor = `hsl(${hue.toFixed(0)}, ${saturation}%, ${lightness}%)`;

  return segments.map((segment, index) => {
    if (segment.length < 2) return null;
    return (
      <Polyline
        key={`polyline-segment-${balloonId}-${index}`}
        positions={segment}
        color={pathColor} // Apply the calculated color
        weight={2.5}
        opacity={0.8}
        smoothFactor={1.5}
        dashArray={"5,8"}
      />
    );
  });
}

/**
 * Renders a marker at the start of the oldest visible path segment.
 * @param {{ balloonId: string, segments: Array<Array<[number, number]>> }} props
 */
function PathStartMarker({ balloonId, segments }) {
  if (segments.length === 0) return null;

  const oldestSegment = segments[segments.length - 1];
  if (!oldestSegment || oldestSegment.length === 0) return null;

  const startPoint = oldestSegment[oldestSegment.length - 1];

  if (!startPoint || !Array.isArray(startPoint) || startPoint.length !== 2) return null;

  return (
    <Marker
      key={`path-marker-${balloonId}`}
      position={startPoint}
      title={`Flight path origin for balloon #${balloonId}`}
      icon={L.divIcon({ className: "path-start-marker", html: "", iconSize: [18, 18], iconAnchor: [9, 9] })}
    />
  );
}

/**
 * Renders the main application UI.
 */
function App() {
  const position = [0, 0];
  const zoom = 2;

  const [balloons, setBalloons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [timeFilter, setTimeFilter] = useState(24);

  const fetchData = useCallback(() => {
    fetchAndProcessBalloonData(setBalloons, setLoading, setError, setLastRefreshed);
  }, []);

  useEffect(() => {
    fetchData();
    const intervalId = setInterval(fetchData, 60 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchData]);

  const totalDistanceAllBalloons = balloons.reduce((sum, b) => sum + (b.totalDistance || 0), 0);
  const averageDistance = balloons.length > 0 ? totalDistanceAllBalloons / balloons.length : 0;
  const maxDistance = balloons.length > 0 ? balloons[0].maxDistance : 0;

  const visiblePathCount = balloons.filter((b) => {
    const cutoffTime = new Date(Date.now() - timeFilter * 60 * 60 * 1000);
    return b.positions.filter((pos) => pos.timestamp >= cutoffTime).length > 1;
  }).length;

  return (
    <div className="App">
      <div className="map-container" style={{ height: "100vh", width: "100%" }}>
        {/* Loading and Error indicators */}
        {loading && <div className="loading-overlay"><div className="loading-spinner">Loading...</div></div>}
        {error && <div className="error-message">{error}</div>}

        <MapContainer
          center={position}
          zoom={zoom}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          minZoom={1.5}
          worldCopyJump={true}
          title="Windborne Systems Global Balloon Constellation Map"
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
          <ZoomControl position="topright" />
          <MapController />

          {balloons.map((balloon) => {
             // Calculate Hue based on distance relative to average (Blue-Green-Red)
             let hue;
             const totalDistance = balloon.totalDistance || 0;
             const saturation = 80;
             const lightness = 50;

             if (averageDistance <= 0) {
               hue = 120; // Default Green
             } else if (totalDistance <= averageDistance) {
               const ratio = totalDistance / averageDistance;
               hue = 240 - ratio * (240 - 120);
             } else {
               const rangeAboveAverage = maxDistance - averageDistance;
               if (rangeAboveAverage <= 0) {
                 hue = 120; // Green
               } else {
                 const distanceAboveAverage = totalDistance - averageDistance;
                 const ratio = Math.min(distanceAboveAverage / rangeAboveAverage, 1);
                 hue = 120 - ratio * 120;
               }
             }
             const markerColor = `hsl(${hue.toFixed(0)}, ${saturation}%, ${lightness}%)`;

            // Filter and sort positions for path
            const cutoffTime = new Date(Date.now() - timeFilter * 60 * 60 * 1000);
            const filteredPositions = balloon.positions.filter((pos) => pos.timestamp >= cutoffTime);
            filteredPositions.sort((a, b) => a.timestamp - b.timestamp);
            const pathSegments = splitPathSegments(filteredPositions);

            return (
              <React.Fragment key={balloon.id}>
                <BalloonMarker balloon={balloon} markerColor={markerColor} />
                <BalloonPath
                  balloonId={balloon.id}
                  segments={pathSegments}
                  totalDistance={totalDistance}
                  maxDistance={maxDistance || 0}
                  averageDistance={averageDistance || 0} // Pass average distance again
                />
                {pathSegments.length > 0 && pathSegments[0].length > 0 && <PathStartMarker balloonId={balloon.id} segments={pathSegments} />}
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>

      <div className="info-panel">
        <h2>Windborne Systems Balloon Constellation</h2>
        <p>Total balloons: <strong>{balloons.length}</strong></p>
        <p>Visible paths: {visiblePathCount}</p>
        <p>Avg Distance (24h): {averageDistance.toFixed(0)} km</p>
        <p>Max Distance (24h): {maxDistance.toFixed(0)} km</p>

        <div className="time-filter">
          <label htmlFor="time-range">Path history: {timeFilter} hours</label>
          <input
            type="range"
            id="time-range"
            min="1"
            max="24"
            value={timeFilter}
            onChange={(e) => setTimeFilter(parseInt(e.target.value, 10))}
          />
        </div>

        {lastRefreshed && (
          <p className="last-refreshed">Last refreshed: {lastRefreshed.toLocaleTimeString()}</p>
        )}
        <p className="data-note">Data auto-refreshes every hour</p>
      </div>
    </div>
  );
}

export default App;
