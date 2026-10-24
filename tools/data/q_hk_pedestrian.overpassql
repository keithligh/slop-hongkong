/* Central core only (same box as HK_CORE_BBOX). south, west, north, east.
   The chase draws this box. Footways, crossings, bus stops, and the street
   furniture OSM already tags. Drivable highways stay in q_hk_highways.overpassql.
   LandsD Road Centreline remains the carriageway; this query is the pavement. */
[out:json][timeout:90];
(
  way["highway"~"^(footway|pedestrian|path|steps|corridor|crossing)$"](22.276,114.150,22.288,114.170);
  node["highway"="bus_stop"](22.276,114.150,22.288,114.170);
  node["public_transport"~"^(platform|stop_position)$"](22.276,114.150,22.288,114.170);
  way["public_transport"="platform"](22.276,114.150,22.288,114.170);
  node["highway"="crossing"](22.276,114.150,22.288,114.170);
  node["amenity"="bench"](22.276,114.150,22.288,114.170);
  node["highway"="street_lamp"](22.276,114.150,22.288,114.170);
);
out geom;
