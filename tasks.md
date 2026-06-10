# Tasks Checklist: NDVI Data Fetcher Improvements

- [x] Layout Restructuring
  - [x] Convert the Control Panel ("NDVI Data Fetcher") into a left sidebar layout
  - [x] Limit bottom-half container to only display stats and forecasting dashboards
  - [x] Ensure correct resizing behaviour of the bottom dashboard relative to the sidebar
- [x] Available Date Selection via Catalog API
  - [x] Implement Sentinel Hub Catalog API endpoint in backend to fetch actual satellite capture dates
  - [x] Integrate Catalog dates in frontend DatePicker dropdown so users can select specific valid dates
- [x] Time-Series Stack Exporter
  - [x] Implement backend endpoint to fetch individual TIFFs for multiple dates and compile them into a ZIP archive
  - [x] Add "Export Time-Series Stack (ZIP)" button and toggle in frontend UI
- [x] Map-Integrated LSTM Forecasting
  - [x] Create color-mapped NDVI overlay on Leaflet map using visual canvas/rendering of GeoTIFF values
  - [x] Bind LSTM forecasts to map so users can step through future months and visualize greenness prediction maps
