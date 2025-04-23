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

import NWSAlertsLayer from './NWSAlertsLayer';

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
 * Fetches NWS alerts - fetches all active alerts nationally.
 * @returns {Promise<object|null>} - Promise resolving to the full FeatureCollection or null if error.
 */
async function fetchNWSAlerts(useProxy = false) {
  const USE_PROXY = useProxy; // Set to true to use proxy, false to use direct API call
  
  if (USE_PROXY) {
    console.log("Fetching all active NWS alerts via proxy...");
  } else {
    console.log("Fetching all active NWS alerts directly...");
  }
  
  // Choose URL based on the proxy setting
  const directUrl = `https://api.weather.gov/alerts/active`;
  const proxyUrl = `/weather-api/alerts/active`; // New proxy endpoint
  
  const url = USE_PROXY ? proxyUrl : directUrl;
  
  // Headers - for direct requests we need to set them, proxy will add them
  const headers = USE_PROXY ? {} : {
    'User-Agent': '(Windborne Balloon Tracker, learning project)',
    'Accept': 'application/geo+json'
  };

  const fetchTimeout = 20000;

  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : { signal: null, abort: () => {} };
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

    console.log("Sending fetch request to:", url);
    const response = await fetch(url, { 
      headers: headers, 
      signal: controller.signal,
      mode: 'cors' // Explicitly set CORS mode
    }).finally(() => clearTimeout(timeoutId));

    console.log("Response received:", {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries([...response.headers.entries()]),
      url: response.url,
      redirected: response.redirected,
      type: response.type
    });

    if (!response.ok) {
      console.warn(`Failed to fetch alerts: ${response.status} ${response.statusText}`);
      
      // If proxy failed, try direct as fallback
      if (USE_PROXY) {
        console.log("Proxy request failed, falling back to direct API call...");
        return fetchNWSAlerts(false); // Retry with direct API
      }
      
      return null;
    }

    // Clone the response before reading it
    const clonedResponse = response.clone();
    
    try {
      // Try to get the raw response text for debugging
      const responseText = await clonedResponse.text();
      console.log("Raw response text length:", responseText.length);
      console.log("Raw response text (first 500 chars):", responseText.substring(0, 500));
      
      // Parse as JSON from the original response
      const data = await response.json();
      console.log("Parsed JSON data available:", !!data);
      
      // Basic check for FeatureCollection format
      if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        console.log(`Successfully fetched ${data.features.length} active alerts.`);
        console.log("First 3 alert features:", data.features.slice(0, 3)); 
        return data; // Return the full FeatureCollection
      } else {
        console.warn(`Unexpected response format:`, data);
        
        // If proxy gave bad format, try direct as fallback
        if (USE_PROXY) {
          console.log("Proxy returned unexpected format, falling back to direct API call...");
          return fetchNWSAlerts(false); // Retry with direct API
        }
        
        return null;
      }
    } catch (parseError) {
      console.error("Error parsing response:", parseError);
      
      // If proxy response couldn't be parsed, try direct as fallback
      if (USE_PROXY) {
        console.log("Failed to parse proxy response, falling back to direct API call...");
        return fetchNWSAlerts(false); // Retry with direct API
      }
      
      return null;
    }
  } catch (fetchError) {
    console.error("Network error fetching alerts:", fetchError);
    
    // If proxy network error, try direct as fallback
    if (USE_PROXY) {
      console.log("Proxy network error, falling back to direct API call...");
      return fetchNWSAlerts(false); // Retry with direct API
    }
    
    return null;
  }
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
 * @param {{ balloon: object, markerColor: string, alerts: Array<object> }} props
 */
function BalloonMarker({ balloon, markerColor, alerts }) {
  if (!balloon.currentPosition) return null;

  // Check if the passed 'alerts' prop (which is now an array of NWS properties) is non-empty
  const hasAlerts = alerts && Array.isArray(alerts) && alerts.length > 0;
  const alertColor = 'orange';
  const finalMarkerColor = hasAlerts ? alertColor : markerColor;
  
  // Improved marker style with better visibility
  const markerRadius = hasAlerts ? 9 : 7; // Increased size
  const pathOptions = {
    color: '#000', // Black border for contrast
    weight: 2, // Thicker border
    fillColor: finalMarkerColor,
    fillOpacity: 0.9, // More opaque fill
    opacity: 1
  };

  if(hasAlerts) {
    console.log(`BalloonMarker (${balloon.id}): Rendering WITH alert indicators.`);
  }

  // Use a custom icon for better visibility
  const balloonIcon = L.divIcon({
    html: `<div style="
      background-color: ${finalMarkerColor}; 
      border: 2px solid #000; 
      border-radius: 50%; 
      width: 100%; 
      height: 100%;
      box-shadow: 0 0 4px white, 0 0 6px rgba(0,0,0,0.7);
      ${hasAlerts ? 'animation: pulse 2s infinite;' : ''}
    "></div>`,
    className: 'balloon-marker-icon',
    iconSize: [hasAlerts ? 18 : 14, hasAlerts ? 18 : 14],
    iconAnchor: [hasAlerts ? 9 : 7, hasAlerts ? 9 : 7]
  });

  return (
    <>
      <Marker
        position={[balloon.currentPosition.lat, balloon.currentPosition.lon]}
        icon={balloonIcon}
        key={`marker-${balloon.id}`}
      >
        <Popup>
          <div className="balloon-popup">
            {/* Balloon Info */}
            <h3>Balloon #{balloon.id} {hasAlerts ? '⚠️' : ''}</h3>
            <p>Lat: {balloon.currentPosition.lat.toFixed(4)}</p>
            <p>Lon: {balloon.currentPosition.lon.toFixed(4)}</p>
            <p>Alt: {balloon.currentPosition.alt?.toFixed(2) ?? 'N/A'} km</p>
            <p>FL: {Math.max(0, Math.round((balloon.currentPosition.alt * 328.084))).toString().padStart(3, "0") ?? 'N/A'}</p>
            <p>Dist (24h): {balloon.totalDistance ? balloon.totalDistance.toFixed(0) : 'N/A'} km</p>
            <p>
              Last updated: <br />
              <span className="timestamp">{balloon.currentPosition.timestamp?.toLocaleString() ?? 'N/A'}</span>
            </p>

            {/* Display NWS Weather Alerts */}
            {hasAlerts && (
              <div className="weather-alerts">
                <h4>Active NWS Alerts:</h4>
                {alerts.map((alertProps, index) => (
                  <div key={alertProps.id || index} className="alert-item">
                    <strong>{alertProps.severity || 'Unknown Severity'}:</strong> {alertProps.event || 'Unknown Event'}
                    <p><small>{alertProps.headline || 'No headline available.'}</small></p>
                    <p><small>Effective: {alertProps.effective ? new Date(alertProps.effective).toLocaleString() : 'N/A'}</small></p>
                    <p><small>Expires: {alertProps.expires ? new Date(alertProps.expires).toLocaleString() : 'N/A'}</small></p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Popup>
      </Marker>
    </>
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
 * Component to handle map interactions like geolocation.
 * @param {{ balloons: Array, setError: Function }} props
 */
function MapInteractionHandler({ balloons, setError }) {
  const map = useMap();

  // Effect for initial geolocation ONLY (now just logs, doesn't flyTo)
  useEffect(() => {
    if (!map) return;
    console.log("MapInteractionHandler: Map instance available.", map);
    if (!navigator.geolocation) {
      console.warn("MapInteractionHandler: Geolocation is not supported.");
      return;
    }
    console.log("MapInteractionHandler: Checking geolocation permission...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        // *** REMOVED map.flyTo ***
        console.log(`MapInteractionHandler: Geolocation allowed: [${latitude.toFixed(4)}, ${longitude.toFixed(4)}]`);
        // map.flyTo([latitude, longitude], 10); 
        // console.log("MapInteractionHandler: map.flyTo called."); 
      },
      (error) => {
        console.warn(`MapInteractionHandler: Geolocation failed or denied: ${error.message}.`);
      },
      { timeout: 10000 }
    );
  }, [map]); // Dependency array is correct

  return null;
}

/**
 * Renders the main application UI.
 */
function App() {
  // *** UPDATED: Better center of Continental US and optimal zoom ***
  const position = [38.5, -98.0]; // Slightly adjusted center of Continental US
  const zoom = 4.5; // Better zoom level to focus on USA

  const [balloons, setBalloons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [timeFilter, setTimeFilter] = useState(24);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [balloonAlerts, setBalloonAlerts] = useState({});
  const [allNwsAlertData, setAllNwsAlertData] = useState(null);

  const fetchBalloonData = useCallback(() => {
    fetchAndProcessBalloonData(setBalloons, setLoading, setError, setLastRefreshed);
  }, []);

  useEffect(() => {
    fetchBalloonData();
    const intervalId = setInterval(fetchBalloonData, 60 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [fetchBalloonData]);

  const averageDistance = balloons.length > 0 
    ? balloons.reduce((sum, b) => sum + (b.totalDistance || 0), 0) / balloons.length 
    : 0;
  const maxDistance = balloons.reduce((max, b) => Math.max(max, b.totalDistance || 0), 0);
  const visiblePathCount = balloons.filter((b) => {
    const cutoffTime = new Date(Date.now() - timeFilter * 60 * 60 * 1000);
    return b.positions && b.positions.length > 1 && b.positions.some(pos => pos.timestamp >= cutoffTime);
  }).length;

  const getAlertsForBalloon = useCallback(async (balloon, allAlerts) => {
      if (!balloon || !balloon.currentPosition || !allAlerts || !allAlerts.features) {
          console.log(`getAlertsForBalloon (${balloon?.id}): Returning null early. Missing balloon, position, or alerts data.`);
          return null;
      }
      
      const { lat, lon } = balloon.currentPosition;
      
      // Ensure lat/lon are valid numbers
      if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) {
          console.warn(`getAlertsForBalloon (${balloon.id}): Invalid coordinates: (${lat}, ${lon})`);
          return null;
      }

      console.log(`getAlertsForBalloon (${balloon.id}): Checking position [${lat.toFixed(4)}, ${lon.toFixed(4)}] against ${allAlerts.features.length} alerts.`);
      
      // Filter alerts by checking if the balloon's position is within each alert's geometry
      const relevantAlerts = allAlerts.features.filter(feature => {
          // Skip if no valid geometry
          if (!feature.geometry || feature.geometry.type !== 'Polygon' || !feature.geometry.coordinates || !Array.isArray(feature.geometry.coordinates[0])) {
              // console.log(`getAlertsForBalloon (${balloon.id}): Skipping alert ${feature.properties?.id} due to invalid/missing Polygon geometry.`); 
              // Note: Commented out by default to avoid excessive logging if many alerts lack geometry
              return false;
          }
          
          try {
              const coordinates = feature.geometry.coordinates[0]; // Get the outer ring
              
              // Ray casting algorithm to check if point is in polygon
              let inside = false;
              for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
                  const xi = coordinates[i][0], yi = coordinates[i][1];
                  const xj = coordinates[j][0], yj = coordinates[j][1];
                  
                  // Basic check for valid coordinate pairs
                  if (typeof xi !== 'number' || typeof yi !== 'number' || typeof xj !== 'number' || typeof yj !== 'number') {
                    console.warn(`getAlertsForBalloon (${balloon.id}): Invalid coordinate pair found in polygon for alert ${feature.properties?.id}`);
                    return false; // Skip this polygon if coordinates are bad
                  }

                  const intersect = ((yi > lat) !== (yj > lat)) &&
                      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
                  if (intersect) inside = !inside;
              }
              
              // *** ADDED LOG: Log result of point-in-polygon check ***
              if (inside) {
                console.log(`getAlertsForBalloon (${balloon.id}): MATCH FOUND! Position is inside alert ${feature.properties?.event} (${feature.properties?.id})`);
              } 
              // else { 
              //   console.log(`getAlertsForBalloon (${balloon.id}): Position NOT inside alert ${feature.properties?.event} (${feature.properties?.id})`); 
              // } // Note: Commented out 'not inside' log to reduce noise
              return inside;
          } catch (e) {
              console.warn(`Error checking if balloon ${balloon.id} is in alert area for alert ${feature.properties?.id}:`, e);
              return false;
          }
      });
      
      // *** ADDED LOG: Log the number of relevant alerts found ***
      console.log(`getAlertsForBalloon (${balloon.id}): Found ${relevantAlerts.length} relevant alerts.`);
      
      // Return just the properties of matching alerts
      return relevantAlerts.length > 0 ? relevantAlerts.map(f => f.properties) : null;
  }, []);

  // Effect to fetch alerts for all balloons
  useEffect(() => {
    async function fetchAndProcessAlerts() {
      if (!balloons.length) return;
      
      setAlertsLoading(true);
      console.log("Starting fetchAndProcessAlerts...");
      
      try {
        // Try with proxy first (true), which will fall back to direct if needed
        const allAlertsData = await fetchNWSAlerts(true);
        
        // *** ADDED: Store the fetched data in state ***
        setAllNwsAlertData(allAlertsData);
        
        console.log("Fetched allAlertsData:", allAlertsData ? `${allAlertsData.features?.length} features` : 'null or undefined');

        if (!allAlertsData) {
          console.error("Failed to fetch alerts after both proxy and direct attempts");
          setAlertsLoading(false);
          return;
        }
        
        // Process alerts for each balloon
        const newAlerts = {};
        
        // *** Using map and Promise.all for potentially better performance ***
        const alertPromises = balloons.map(async (balloon) => {
          if (!balloon.currentPosition) return; // Skip if no position
          
          try {
            const alerts = await getAlertsForBalloon(balloon, allAlertsData);
            if (alerts) {
              console.log(`Alerts found for balloon ${balloon.id}:`, alerts);
              newAlerts[balloon.id] = alerts;
            }
          } catch (error) {
            console.error(`Error processing alerts for balloon ${balloon.id}:`, error);
          }
        });
        
        await Promise.all(alertPromises);

        console.log("Setting balloonAlerts state with:", newAlerts);
        setBalloonAlerts(newAlerts);

      } catch (error) {
        console.error("Error in fetchAndProcessAlerts:", error);
      } finally {
        setAlertsLoading(false);
        console.log("Finished fetchAndProcessAlerts.");
      }
    }
    
    fetchAndProcessAlerts();
    // Refresh alerts every 15 minutes
    const intervalId = setInterval(fetchAndProcessAlerts, 15 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [balloons, getAlertsForBalloon, setAllNwsAlertData]);

  return (
    <div className="App">
      <div className="map-container" style={{ height: "100vh", width: "100%" }}>
        {(loading || alertsLoading) && (
            <div className="loading-overlay">
                <div className="loading-spinner">
                    Loading {loading ? 'balloon data' : ''}
                    {loading && alertsLoading ? ' and ' : ''}
                    {alertsLoading ? 'NWS alerts...' : ''}
                    {!loading && !alertsLoading ? '...' : ''}
                </div>
            </div>
        )}
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

          <MapInteractionHandler balloons={balloons} setError={setError} />

          {allNwsAlertData && <NWSAlertsLayer allAlerts={allNwsAlertData} />}

          {balloons.map((balloon) => {
             let hue;
             const totalDistance = balloon.totalDistance || 0;
             const saturation = 80;
             const lightness = 50;
             if (averageDistance <= 0 || !isFinite(averageDistance)) { hue = 120; }
             else if (totalDistance <= averageDistance) { hue = 240 - (totalDistance / averageDistance) * 120; }
             else {
               const rangeAboveAverage = maxDistance - averageDistance;
               if (rangeAboveAverage <= 0 || !isFinite(rangeAboveAverage)) { hue = 120; }
               else { hue = 120 - Math.min((totalDistance - averageDistance) / rangeAboveAverage, 1) * 120; }
             }
             const markerColor = `hsl(${hue.toFixed(0)}, ${saturation}%, ${lightness}%)`;

            // Use pre-fetched alerts from state instead of calling getAlertsForBalloon directly
            const alertsForBalloon = balloonAlerts[balloon.id] || null;

            const cutoffTime = new Date(Date.now() - timeFilter * 60 * 60 * 1000);
            const filteredPositions = (balloon.positions || [])
               .filter((pos) => pos.timestamp >= cutoffTime);
            const pathSegments = splitPathSegments(filteredPositions);

            return (
              <React.Fragment key={balloon.id}>
                {balloon.currentPosition && (
                    <BalloonMarker
                        balloon={balloon}
                        markerColor={markerColor}
                        alerts={alertsForBalloon}
                    />
                )}
                {pathSegments.length > 0 && (
                    <BalloonPath
                      balloonId={balloon.id}
                      segments={pathSegments}
                      totalDistance={totalDistance}
                      maxDistance={maxDistance}
                      averageDistance={averageDistance}
                    />
                )}
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>

      <div className="info-panel">
        <h2>Windborne Systems Balloon Constellation</h2>
        <p>Total balloons: <strong>{balloons.length}</strong></p>
        <p>Visible paths ({timeFilter}h): {visiblePathCount}</p>
        <p>Avg Distance (24h): {isFinite(averageDistance) ? averageDistance.toFixed(0) : 'N/A'} km</p>
        <p>Max Distance (24h): {isFinite(maxDistance) ? maxDistance.toFixed(0) : 'N/A'} km</p>

        <div className="time-filter">
          <label htmlFor="time-range">Path history: {timeFilter} hours</label>
          <input
            type="range"
            id="time-range"
            min="1"
            max="24"
            value={timeFilter}
            onChange={(e) => setTimeFilter(parseInt(e.target.value, 10))}
            aria-labelledby="time-range-label"
          />
          <span id="time-range-label" style={{ display: "none" }}>Path history duration</span>
        </div>

        {/* --- START LEGENDS --- */} 
        <div className="legend-section">
            <h4>Balloon Path Color</h4>
            <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'hsl(240, 80%, 50%)' }}></span>
                <span>Shortest Distance (relative)</span>
            </div>
             <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'hsl(120, 80%, 50%)' }}></span>
                <span>Average Distance</span>
            </div>
             <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'hsl(0, 80%, 50%)' }}></span>
                <span>Longest Distance (relative)</span>
            </div>
        </div>

        <div className="legend-section">
            <h4>Weather Alerts</h4>
             <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'rgba(255, 0, 0, 0.25)', border: '2px solid #800000' }}></span>
                <span>Extreme Alert</span>
            </div>
             <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'rgba(255, 100, 0, 0.25)', border: '2px solid #cc5500' }}></span>
                <span>Severe Alert</span>
            </div>
             <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'rgba(255, 165, 0, 0.25)', border: '2px solid #cc8800' }}></span>
                <span>Moderate Alert</span>
            </div>
             <div className="legend-item">
                <span className="legend-color-box" style={{ backgroundColor: 'rgba(255, 255, 0, 0.2)', border: '2px solid #aaaa00' }}></span>
                <span>Minor Alert</span>
            </div>
             <div className="legend-item">
                 <span>⚠️</span> 
                 <span style={{ marginLeft: '8px'}}>Balloon in Alert Area</span>
             </div>
        </div>
        {/* --- END LEGENDS --- */}

        {lastRefreshed && (
          <p className="last-refreshed">Balloon data refreshed: {lastRefreshed.toLocaleTimeString()}</p>
        )}
        <p className="data-note">Balloon data auto-refreshes hourly. NWS alerts refresh every 15 mins.</p>
      </div>
    </div>
  );
}

export default App;
