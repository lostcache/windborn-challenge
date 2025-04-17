# Windborne Balloon Constellation Tracker

## Overview
This application displays Windborne Systems' balloon constellation on an interactive global map, with live tracking of balloon positions and flight paths.

## Features
- Global view of all balloons in the constellation
- Real-time tracking with current location markers
- Historical flight paths with time filter (1-24 hours)
- Detailed balloon information (coordinates, altitude, flight level)
- Auto-refresh mechanism to keep data current
- Responsive design with loading indicators and error handling

## How It Works

The application fetches data from the Windborne API endpoints:

```
https://a.windbornesystems.com/treasure/00.json  (current positions)
https://a.windbornesystems.com/treasure/01.json  (1 hour ago)
...
https://a.windbornesystems.com/treasure/23.json  (23 hours ago)
```

Each balloon's position is tracked through time, allowing the visualization of flight paths across the globe.

## Technical Implementation

- **React** for UI components and state management
- **react-leaflet** for map rendering and interactive features
- **Leaflet** for custom markers and polylines
- Efficient data fetching with proper error handling
- Time-based filtering of historical data

## Getting Started

1. Install dependencies: `npm install`
2. Start development server: `npm start`
3. View application in browser at: `http://localhost:3000`

## Required Dependencies

- React
- react-leaflet
- leaflet