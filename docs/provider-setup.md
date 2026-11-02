# Additional weather sources

Provider credentials belong in the host's settings. Public dashboards must not receive Ecowitt keys or station tokens. Recovery never replaces an existing observation.

## Archive repair

Select a past range of 1–7 days in History. Recovery splits it into requests of at most one day. Tempest repair requires its token and numeric device ID. Ecowitt repair requires `ecowittAppKey`, `ecowittApiKey`, and `ecowittMac`, obtained from your own Ecowitt account, with the station configured as Ecowitt/push. Requests use five-minute history and explicit Celsius, hPa, m/s, and mm units. Five-minute data is limited to the last 90 days. Older Ecowitt tiers are coarser and are deliberately not mixed into the five-minute archive.

For live Ecowitt uploads, configure a distinct ingest key for each station. Uploads that carry a MAC are checked against the selected MAC; MAC-less uploads cannot prove which hardware sent them. A cloud-history MAC alone does not isolate anonymous uploads.

Missing values stay missing. Rain increments are computed only between adjacent five-minute cumulative readings; missing intervals and counter resets cannot establish how much rain fell during a single interval. The first returned reading therefore has no interval rain unless supplied directly by Tempest. Recovered rows carry a cloud-source tag. Empty replies are reported as empty, not proof that an archive gap is repaired. API errors, rate limits and credential errors leave the archive unchanged.

See [Ecowitt history documentation](https://doc.ecowitt.net/web/#/1?page_id=19) and [WeatherFlow REST API](https://weatherflow.github.io/Tempest/api/).

## Local PurpleAir

Set `purpleAirHost` to the sensor's private IPv4 address, such as `192.168.1.43`; `localhost` is also accepted. Only HTTP port 80 and the fixed `/json` path are fetched, without redirects. Hostnames, arbitrary URLs, public addresses, and other ports are rejected. A sensor reservation in your router keeps its address stable.

The host reads the sensor's two-minute ATM PM2.5 concentrations from channels A and B. These are uncorrected sensor readings, not a daily regulatory AQI. Missing channels are excluded from the mean; timestamps older than ten minutes are displayed as stale. Wi-Fi SSID and hardware identifiers from sensor JSON are not exposed. This integration requires the StormDesk host to reach the sensor; a standalone static page cannot poll it through the host route.

See [PurpleAir local access](https://community.purpleair.com/t/view-sensor-data-locally-over-wifi-json-data/5513/1) and [sensor fields](https://community.purpleair.com/t/sensor-json-documentation/6917).

## Pollen, Canadian warnings, and river gauges

Open-Meteo's CAMS pollen forecast covers Europe during pollen season, with up to four days for alder, birch, grass, mugwort, olive and ragweed. Mold is not available. Missing data and unsupported regions are shown as unavailable. [Provider documentation](https://open-meteo.com/en/docs/air-quality-api).

Canadian warnings come from Environment and Climate Change Canada's GeoMet weather-alerts collection. Warning polygons are checked against the selected location, duplicate polygon records are removed, and expired or ended warnings are discarded. Official alert text, type and risk colour are preserved. ECCC colours are not translated into invented NWS severity levels. A failed/incomplete response means warnings are unavailable, not that no warning exists. [ECCC documentation](https://eccc-msc.github.io/open-data/msc-data/alerts/readme_alerts-geomet_en/).

For rivers, use a NOAA NWPS gauge identifier such as `PTTP1` under **Settings → More tools → Weather sources, sensors & camera**. The panel shows timestamped observations, recent history, and the gauge's published action/minor/moderate/major thresholds when their units match the observation. Balanced Desk also shows the maximum within the available forecast, its time and source units, and a comparable flood stage. No nearby gauge is silently substituted. Missing sentinel values are discarded. Observations older than two hours and outdated forecasts are labeled stale. A gauge reading or forecast describes that gauge, not the water level or flood risk at a user's home. [NOAA API documentation](https://api.water.noaa.gov/nwps/v1/docs/).

NOAA WPC Winter Storm Severity Index (WSSI) uses the selected location to query mapped overall impacts for Days 1–3 in the contiguous United States. The summary reports the highest valid impact category with its issue and validity times. A missing, incomplete or failed response stays unavailable rather than implying an all-clear.
