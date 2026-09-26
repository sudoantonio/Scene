<p align="center">
  <img src="docs/assets/scene-logo.png" alt="Scene" width="720">
</p>

# Scene

**Scene is a local desktop editor for creating 3D storyboards and animatics. Blender must be installed to use its 3D production workflow.**

Blender is extremely powerful, but its broad feature set also introduces a steep learning curve and a great deal of setup for people who only need to plan a video. Scene removes that overhead and keeps the workflow focused on the essentials: composing shots, arranging 3D objects and 2D layers, defining camera movement and timing, adding audio, and writing precise production notes. The result is a structured, editable project that can be exported to Blender and used as input for an AI coding agent.

Scene includes **TypeSafe Jev** and **Laya** for turning written directions into validated actions and animation keyframes. Jev is integrated in the editor; we are currently developing and training Laya for Scene's controls and workflow. Laya's behavior is experimental while that work continues.

<p align="center">
  <img src="docs/assets/scene-interface.png" alt="Scene interface showing the 3D stage, camera path, character, and timeline" width="1200">
</p>

## Download

For Apple Silicon Macs, [download Scene 0.59.5 as a ZIP](https://github.com/sudoantonio/Scene/releases/download/v0.59.5/Scene-0.59.5-mac-arm64.zip), extract it, and move `Scene.app` to Applications. [All releases](https://github.com/sudoantonio/Scene/releases) are listed on GitHub. Blender must also be installed for Scene's 3D build and render workflow.

The Mac app is not yet signed with an Apple Developer ID or notarized. macOS may report that the downloaded app is “damaged” even when the ZIP is intact. For version 0.59.5, verify the downloaded ZIP with `shasum -a 256 ~/Downloads/Scene-0.59.5-mac-arm64.zip`; its SHA-256 must be `e8b8597f2ed9e8daf89afef7ff2d6cde341ca6cfacdac315c6cf5121eb59cda8`. If it matches, extract the ZIP and run `xattr -dr com.apple.quarantine /path/to/Scene.app` on **that extracted app only** before opening it. You can drag `Scene.app` from Finder into Terminal to insert its exact path. Do not disable macOS security globally. A warning-free download requires Apple Developer ID signing and notarization.

## Why Scene exists

Recent AI models have become very capable at creating, modifying, and organizing 3D content. At the same time, ABACO needed a more consistent way to produce educational animated content for its social channels.

These two needs led to **Scene**: a tool designed to turn an idea into a 3D storyboard without requiring specialist skills. Its primary goal is to make storyboarding faster and less tiring. Blender can do far more, but learning and navigating features that are not needed during previsualization can make a simple storyboard unnecessarily slow to produce. Scene reduces the number of tools and decisions involved, so users can concentrate on the sequence, composition, timing, and instructions.

Scene is not intended to replace Blender or professional animation software. It provides a focused starting point for the early planning stage, while keeping the project ready for more advanced work later.

A project created with Scene can be opened directly in Blender or passed to a preferred coding agent—such as Codex, Claude Code, or Cursor—together with detailed instructions for extending, automating, or refining the 3D scene.

Scene is still an early-stage project and is intentionally focused. It was created for ABACO's social-media production workflow and will evolve as new practical needs emerge. The code is available to anyone facing a similar challenge who wants to adapt it, extend it, or integrate additional services, APIs, and automations.

## Features

- organize multiple scenes on a continuous timeline;
- add 3D primitives, Blender files, images, and 2D text;
- define shots, camera positions, and motion using timeline control points;
- keep every motion path visible in the active scene, with objects in red and the camera in cyan;
- click anywhere on a motion path to insert and drag a new control point;
- direct the selected camera or 3D element from one centered input, switching between TypeSafe Jev and local Laya;
- attach production notes to scenes, movements, and individual elements;
- import audio tracks, display their waveforms, and adjust volume;
- preview the animatic directly in the editor;
- export versioned Blender projects and a separate WAV audio track;
- save portable projects with their assets collected alongside the scene data;
- export subtitles at their final video seconds and frames alongside the mounted audio, in SRT and JSON for AI handoff.

## Workflow

1. Create the scenes and set their duration.
2. Add the required elements and compose each shot.
3. Record or edit camera and object motion on the timeline.
4. Add production notes and audio tracks.
5. Save the project and export the `.blend` file.
6. Continue manually in Blender, or pass the project and its instructions to an AI agent for more advanced work.

Projects are saved as `scene.abaco.json`. Exports are created next to the project in incrementally versioned folders (`exports/v001`, `v002`, and so on), so previous versions are never overwritten.

## Architecture

Scene is a desktop application built with Electron, React, and Three.js. Project data is validated with Zod, while Blender exports are generated by a deterministic local Python script.

The application can compose scenes and export projects without an API key, but Blender must be installed for the 3D build and render workflow. AI integrations are optional: OpenAI powers the advanced Blender plan, while TypeSafe Jev or local Laya converts a bounded character action into typed decisions that Scene compiles into keyframes. API keys are encrypted with Electron's `safeStorage` and are never included in project files. Laya needs no API key; its ONNX model is downloaded to the user's cache on first use and then runs locally. Scene evaluates Laya's independent movement questions sequentially, keeping native ONNX memory bounded on Apple Silicon while the loaded model remains warm.

Plans produced by the model are validated before they are applied. The model cannot provide arbitrary Python code, select local filesystem paths, or directly delete project elements.

Jev and Laya do not generate arbitrary animation JSON. Their centered composer is a single input with a Jev/Laya switch: select a camera or 3D element, describe the action and press Enter. The selected item is always the target, so camera instructions do not need to repeat the word “camera”. Both engines receive the same complete operational context for the active scene: object names and transforms, existing animation, camera and framing data, lighting, scene directions, timeline metadata and the attached animation brief or standard. Scene extracts verb-scoped trigger hints, then asks twelve separate binary questions for positive and negative translation and rotation on X, Y and Z. Conflicting opposite answers resolve to hold, while explicit phrases such as “sposta a destra” and “guarda a destra” remain translation and yaw respectively. The engines choose among Scene's allowed subject actions and camera moves, including push, pull, truck, pan, tilt, orbit and follow, then Scene applies the validated keyframes directly. The composer reports total and decision latency after every run for a direct performance comparison. When a camera instruction names an element—or refers generically to the character or subject—Scene resolves that element and keeps it framed throughout the movement. A direction can combine written staging with a trajectory drawn in either free or camera view; Scene reduces ordinary strokes to at most four view-relative movement points. A closed orbit uses nine evenly spaced points so the circle stays round, preserves the real camera-to-subject radius and locks the camera height unless the instruction explicitly asks it to rise or descend. Applying a revised plan replaces its earlier points in that scene instead of accumulating them. Motion paths and their main keyframe points remain visible throughout the active scene: red identifies subjects and objects, while cyan identifies the active camera. Clicking any part of a path inserts a control point at that moment so the curve can be edited directly.

## Requirements and development

Install Blender before using Scene. The application uses Blender to create and render the 3D project; on macOS it looks for `/Applications/Blender.app`, and on Linux it detects the `org.blender.Blender` Flatpak. You can choose another Blender executable in Scene's settings.

To run Scene from source, you also need:

- Node.js 22 or later;
- npm.

```bash
npm install
npm run dev
```

## Testing and packaging

```bash
npm test
npm run build
npm run package:linux
npm run package:mac
```

Packages are generated in `release/`: AppImage for Linux and ZIP for Apple Silicon Macs.

## Project status

Scene is experimental and under active development. We are currently adapting and training Laya for Scene-specific animation and camera directions. Its current feature set is intentionally small and focused on ABACO's internal workflow. Bug reports, adaptations, and integrations are welcome, provided they preserve an experience that remains simple and understandable for people who do not regularly work with 3D software.

> **Development time:** two days. Blender has had a bit of a head start.

## License

Scene is released under the [Apache License, Version 2.0](LICENSE). You may use, modify, and distribute it under that license. Redistributed copies and derivative works must retain the relevant attribution in [NOTICE](NOTICE).

## 0.57.41: direction presets in Scenografia

Open Scenografia. The Regia section contains freeform scene, camera and object directions. Type `/` in camera or object fields to select and combine presets; full versioned prompt snapshots are stored with the comment. The narrative scene field remains empty by default. The Standard animazione section in the same panel accepts .md/.txt files (UTF-8, max 500 KB) or the bundled cartoon standard. Its content is embedded in the JSON and exported with the animation handoff. The two header commands from 0.57.40 have been removed.

Validation: 135 tests pass, including the actual Inspector/Scenografia inputs, preset selection and saving, and embedded standard loading. Compiled renderer checked in a native Electron window with an isolated QA profile.
