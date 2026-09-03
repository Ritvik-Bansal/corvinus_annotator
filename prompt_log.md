[1] hi! i've got a project that i'm working on and before we write any code i want your
input on what to build it in.

the task is to create a image annotation app that is browser based specifically for computer vision and dataset prep. it needs canvas drawing tools (bounding boxes, polygons, brush, and mask erase), label management (predefined+custom class labels for example "Pipette Tip" and "Reagent Bottle"), dynamic keyvalue data for each annotation ("Liquid Level: 50%", "State: Open"), and a feature to export all annotations, coordinates, labels and metadata through a structured JSON with also a feature to import that JSON back into the annotator.

I'll be creating the deliverables on my own (codebase, live demo link, video walkthrough, and system architecture summary)

context on me and my constraints: i'm demoing this live and getting grilled on it, so being able to explain the decision (architecture) matters a lot, so i will be making all those decisions. im reviewing every diff instead of letting you run ahead. images could be large, like 12 megapixel phone photos, and panning + zooming has to stay smooth. one image at a time, no multiimage workflow and ideally we deploy it somewhere free as a static site

what i want from you right now. do NOT write any code yet:

I want a recommend a stack, framework or no framework, language, build tool, and how you'd handle app state. specifically address whether i should use a canvas library (konva, fabric, paper.js, etc.) or draw directly against the canvas 2d api. what does each choice cost me (performance is super important). give me at least two alternatives to consider and why you'd NOT use them. make sure to call out anything in my constraints that should change your answer. also im wondering: what do u think is gonna be  the hardest part of this build+ why.

i already have my own plan and i'm going to compare your output against it.

