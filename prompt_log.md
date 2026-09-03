[1] hi! i've got a project that i'm working on and before we write any code i want your
input on what to build it in.

the task is to create a image annotation app that is browser based specifically for computer vision and dataset prep. it needs canvas drawing tools (bounding boxes, polygons, brush, and mask erase), label management (predefined+custom class labels for example "Pipette Tip" and "Reagent Bottle"), dynamic keyvalue data for each annotation ("Liquid Level: 50%", "State: Open"), and a feature to export all annotations, coordinates, labels and metadata through a structured JSON with also a feature to import that JSON back into the annotator.

I'll be creating the deliverables on my own (codebase, live demo link, video walkthrough, and system architecture summary)

context on me and my constraints: i'm demoing this live and getting grilled on it, so being able to explain the decision (architecture) matters a lot, so i will be making all those decisions. im reviewing every diff instead of letting you run ahead. images could be large, like 12 megapixel phone photos, and panning + zooming has to stay smooth. one image at a time, no multiimage workflow and ideally we deploy it somewhere free as a static site

what i want from you right now. do NOT write any code yet:

I want a recommend a stack, framework or no framework, language, build tool, and how you'd handle app state. specifically address whether i should use a canvas library (konva, fabric, paper.js, etc.) or draw directly against the canvas 2d api. what does each choice cost me (performance is super important). give me at least two alternatives to consider and why you'd NOT use them. make sure to call out anything in my constraints that should change your answer. also im wondering: what do u think is gonna be  the hardest part of this build+ why.

i already have my own plan and i'm going to compare your output against it.

--------------

[2] i want the languges we use to be typescript + vite, no framework, plain canvas 2d, hand-rolled state.

also here are two additions i decided on after reading your answer: masks are stroke lists in memory, but export ALSO emits an RLE raster mask per class along with the strokes, so the json is still usable. also the eraser removes pixels from every class, not just the active selected one.

right now i only want phase 0 which is gonna be scaffold and deploy. no app code yet.

goal:
a working vite and typescript project that builds and is live on a public url.

what i want: exact terminal commands to scaffold, one at a time. add a one-line explanation of what each does. i'm on macos, zsh, node already installed. i also want the folder structure you'd set up for this project and why each folder exists. i want what goes in vite.config.ts and index.html, and why. give me deploy instructions. i want it live on a public url asap. for example tell me github pages vs netlify vs vercel and pick one for this situation then give me the steps

constraints: i dont want any dependencies other than vite and typescript unless you tell me why first. for now, no app logic, no canvas code, nothing about annotation yet. NOTE: i am new to typescript so when you use syntax that isn't easy to understand, add a simple one lined comment explaining it

after the commands tell me exactly what i should see on screen if it worked

--------------

[3] phase 1 (part a) will focus only on the state module only! no rendering, no canvas, no image loading, etc. currently we have an empty scaffold, src/ has only main.ts and we need to build the document shape and state module first since everything depends on it. our goal is to create typescript types for the annotation document, plus a small state module that holds it and notifies on any change

im thinking the document has six top level keys. these include version, exportedAt, image, labels, annotations, and strokes

image will have fileName, width, height labels will have an array of id, index, name, color, attributes, where attributes are an array of definitions that include key, name, type, and type-specific fields like min/max for number or options for enum. annotations will have an array of id, type, labelId, attributes, geometry, createdAt, updatedAt. the type will be bbox or polygon and attributes here is the actual keyvalue data. geometry differs by type obviously strokes should be ONE ordered list for the whole image, not per annotation. each stroke is id, labelId, mode: paint or erase, radius, and point. i beleive the order matters because an erase stroke removes pixels from every class, not just its own

split document state from session state. document state (the six keys above) is exported and undoable. session state however is NOT exported and NOT undoable so like viewport (scale, offsetX, offsetY), activeTool, activeLabelId, brushRadius, selection

what i want: 1 the types, in their own file, 2 a state module holding the document plus session state, with subscribe/notify, 3 undo/redo over document state only, using structuredClone snapshots, capped at 40, 4 three seed labels: Reagent Bottle, Pipette Tip, Microplate, with index 1, 2, 3 and attribute defs that make sense

make sure u explain any typescript syntax that isn't obvious in a oneline comment SIMPLY. essentially, i should be able to create a document, add an annotation, undo, redo, and get identical state and changing the viewport does not add an undo entry and also subscribe fires when the document changes

--------------

[4] before phase 1b, two things: add the DeepReadonly mapped type to getDocument(). since u said it was free lets take it. i don't want all writes go through commit() but prefer  the compiler to reject direct mutation. if it turns out to be more than a few lines or it fights with the stroke union type stop and tell me instead of forcing it. also confirm store.check.ts is not ending up in the production bundle. tell me how you verified it.

then push!

after that phase 1 part b: domain actions only!

i want typed functions for the operations the app actually performs so tools arent calling commit() directly.

i want addAnnotation, removeAnnotation, updateAnnotationGeometry, setAttribute, addStroke, etc (what ever u else deem fit). new annotations should get their label's attribute default values applied automatically

--------------

[5] phase 1 part c now which is gonna be canvas and image loading. i wanna see output on the screen now. i believe we finished out state layer but nothing renders yet. we need to be able to load an image with the plus button, see it on screen and pan and zoom it smoothly

i want three stacked canvas elements (image, annotations, overlay) only the image layer draws this phase, the other two exist but stay empty. screenToImage and imageToScreen conversion functions should be implemented. all stored coordinates are in image pixel space. these two functions should be the ONLY place coordinate math happens.i want a plus button in a top bar that opens a file picker, loads an image, and sets appropriate fields in the doc. i should be able ot pan by dragging, zoom with scrool wheel. u should also handle devicepixelratio. make sure to add a zoom status bar pecent and cursor postion in image coordinates and milliseconds per frame at the bottom (image of layout attached).

remember no annotation tools, no drawing, no sidebar yet

--------------

[6] three fixes first then phase 2.

FIXES:
1. two-finger scroll pans, pinch zooms branch on event ctrlKey
2. loading an image resets the document and clears undo history - taking your sugestion
3. the ms/frame readout is measuring the wrong thing. right now it times how long our draw calls take to issue, which excludes all the gpu work and reads 0.05ms but that's misleading. measure the interval between consecutive rAF callbacks instead, which is the real end to end frame cost. show a rolling median over the last ~60 frames so it doesn't flicker. display both numbers. the frame interval and separately the time our draw code costs.

phase 2 is tool rail and the rectangle tool. I wannt a working tool rail, and the ability to draw, select, move and resize bounding boxes. i need a tool interface so every tool is an object. all pointer events route through one place that dispatches to the active tool. build this structure  as it will be important later for the polygon and brush tools. the left rail with six icons - select V, rectangle R, polygon P, brush B, eraser E, pan H. polygon, brush and eraser are visible but disabled for this phase. keyboard shortcuts work. the rectangle tool is drag to create. the box is stored in image coordinates. the select tool is click a shape to select it, drag to move it, drag corner handles to resize. the delete key removes the selected shape. annotations draw on the annotations layer, and have an annotation count in the status bar.

--------------

[7] one small fix then phase 3. change the draw timing display to microseconds. 0.00 ms looks broken..

phase 3 is the sidebar, labels and attributes. we essentialy need to make the right panel, pick a class before drawing, see all annotations, and be able to edit the attributes of whatever is selected.

the right panel should roughly be 300px with three sections stacked which are classes, annotations and attributes. i need the classes list which are the three seed labels with their color swatches (blue for reagent, green for pipette, and red for microplate). clicking one should set the label. make it so that the number keys 1-9 do the same. we also need to add an "add new class" button that asks for a name and picks a color. create an annotations list for every annotation with its type and class. clicking one selects/shows it on the canvas. selecting on the canvas higlights it in list. also need a attributes section which will show the attribute fields for whatever is selected. number type renders a number input, enum renders a dropdown, boolean renders a checkbox, etc. editing updated the annotation. make sure that the boxes use thier class color and have a class label on top.

--------------

here r a few things before we start the next phase. the add class dialog needs some fixing as right now its two dialoges and if i typo a type like "bollean" it auto turns into a text field w no warning/error so lets replace it w an inline form in the classes section itself. it should hv a name field, color, and way to add attributes. each attribute row would be a name field plus a type dropdown. if the type is enum have one more field for its options.

also i need to have a delete class feature. have a small x on the row and if the class is in use tell me how many annotations use it and let me confirm cuz that will delete annotations as well - make sure this option can be undone.

on the visual side lets dial it back - right now theres a purple accent on the buttons and selected row plus class colors are pastels. we wil be going plain. greys and pitch blacks for chromes, no accent colors except a thin border on selected items. for the three classes use straight saturated colors.

then phase 4 which is the polygon tool. i want the polygon to be enabled in the left sidebar. we should be able to click to place each vertex and in progress shape draws on the overlay with a simple line that follows the users cursor, enter or clicking the first vertex shoud close it and hitting escape cancels the whole thing, and finally the select tool should be able to work on it aswell so like click to select and drag to move the whole shape and also being able ot drag a vertex to move just that vertex and change the polygon itself.

make sure u dont add stuff i didnt ask for