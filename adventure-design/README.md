# Adventure and map presentation

Both PNGs are unchanged originals from the uploaded Adventure Mode and Map ZIP.
The 1672×941 reference supplies the Adventure frame, backdrop and control art.
Existing Back, wallet, Chest, session counter, hero deployment/rest, camera and
roster controls remain interactive DOM. Actual player values cover the sample
values printed in the reference. The ten roster slots remain available.

The live battlefield replaces the example battlefield inside that frame.
Ground, walls and themed props use explicit crops from the provided artwork.
Stages cycle through the eight supplied themes: Shinobi Village, Cherry
Blossom Temple, Bamboo Forest, Lava Caves, Snow Mountain, Night City, Desert
Ruins and Spirit Realm. Walls and decorative props follow real collision cells;
players and targets retain their real game positions. Rendering reads the grid
and leaves stage generation, pathfinding and combat rules intact.

The helper patches only camera/floor/wall/decoration rendering and adds the
presentation assets. Its guards reject changed or partly patched upstream code.
The shared readiness chain ensures art is loaded before the startup gate opens.
