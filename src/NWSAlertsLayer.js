import React from 'react';
import { Polygon, Popup } from 'react-leaflet';

/**
 * Renders NWS alert polygons directly on the map.
 * @param {{ allAlerts: object }} props - Expects allAlerts to be the NWS FeatureCollection.
 */
function NWSAlertsLayer({ allAlerts }) {
  if (!allAlerts || !allAlerts.features || !Array.isArray(allAlerts.features)) {
    console.log("NWSAlertsLayer: No valid alert features to display.");
    return null;
  }

  console.log(`NWSAlertsLayer: Rendering ${allAlerts.features.length} potential alert features.`);

  return (
    <>
      {allAlerts.features.map((feature) => {
        // Basic validation for Polygon geometry and coordinates
        if (
          !feature ||
          !feature.geometry ||
          feature.geometry.type !== 'Polygon' ||
          !feature.geometry.coordinates ||
          !Array.isArray(feature.geometry.coordinates[0]) ||
          feature.geometry.coordinates[0].length < 3 // Need at least 3 points for a polygon
        ) {
          // console.log(`NWSAlertsLayer: Skipping feature ${feature?.properties?.id} due to invalid/missing Polygon geometry.`);
          return null; // Skip features without valid Polygon geometry
        }

        // NWS GeoJSON coordinates are [lon, lat], Leaflet needs [lat, lon]
        // We need to swap the order for each coordinate pair.
        let leafletPositions;
        try {
          leafletPositions = feature.geometry.coordinates[0].map(coord => {
            if (!Array.isArray(coord) || coord.length !== 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
              throw new Error(`Invalid coordinate pair found: ${JSON.stringify(coord)}`);
            }
            // Swap [lon, lat] to [lat, lon]
            return [coord[1], coord[0]];
          });
        } catch (error) {
           console.warn(`NWSAlertsLayer: Error processing coordinates for alert ${feature.properties?.id}: ${error.message}`);
           return null; // Skip this feature if coordinates are bad
        }

        const alertProps = feature.properties || {};
        const alertId = alertProps.id || `feature-${Math.random()}`; // Use ID or generate fallback key

        // Define visual style for the alert polygon
        const pathOptions = {
          fillColor: 'orange',
          fillOpacity: 0.2,
          color: 'red', // Border color
          weight: 1,
        };

        return (
          <Polygon key={alertId} pathOptions={pathOptions} positions={leafletPositions}>
            <Popup>
              <div>
                <h4>{alertProps.event || 'Weather Alert'}</h4>
                <p><strong>Severity:</strong> {alertProps.severity || 'N/A'}</p>
                <p><strong>Certainty:</strong> {alertProps.certainty || 'N/A'}</p>
                <p><strong>Urgency:</strong> {alertProps.urgency || 'N/A'}</p>
                <p><small>{alertProps.headline || 'No headline.'}</small></p>
                 <p><small>Effective: {alertProps.effective ? new Date(alertProps.effective).toLocaleString() : 'N/A'}</small></p>
                 <p><small>Expires: {alertProps.expires ? new Date(alertProps.expires).toLocaleString() : 'N/A'}</small></p>
                 {/* Link to full alert if available? */}
                 {/* <p><a href={alertProps['@id']} target="_blank" rel="noopener noreferrer">More Info</a></p> */}
              </div>
            </Popup>
          </Polygon>
        );
      })}
    </>
  );
}

export default NWSAlertsLayer; 