diff --git a/client/src/pages/CanvasPage.tsx b/client/src/pages/CanvasPage.tsx
index 24771a6..1a6a517 100644
--- a/client/src/pages/CanvasPage.tsx
+++ b/client/src/pages/CanvasPage.tsx
@@ -5,10 +5,13 @@ import {
   Controls,
   Handle,
   MarkerType,
+  MiniMap,
+  NodeResizer,
   Position,
   ReactFlow,
   applyNodeChanges,
   useEdgesState,
+  useReactFlow,
   type Connection,
   type Edge,
   type Node,
@@ -40,7 +43,7 @@ import type {
   StoryScene,
   StorySceneDetail,
 } from "../types";
-
+//
 // ┬л╨Я╨╛╨╗╨╛╤В╨╜╨╛┬╗ тАФ ╤Г╨╖╨╗╨╛╨▓╨╛╨╣ ╤А╨╡╨┤╨░╨║╤В╨╛╤А. ╨Я╨╡╤А╨▓╤Л╨╣ ╨▓╨╕╨┤ ╤Е╨╛╨╗╤Б╤В╨░: ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡, ╨╡╨│╨╛ ╤Б╤Ж╨╡╨╜╤Л
 // ╨╜╨╛╨┤╨░╨╝╨╕, ╨┐╨╡╤А╨╡╤Е╨╛╨┤╤Л ╤А╤С╨▒╤А╨░╨╝╨╕.
 //
@@ -51,7 +54,9 @@ import type {
 //
 // ╨а╨╡╤И╨╡╨╜╨╕╤П, ╨╕╨╖-╨╖╨░ ╨║╨╛╤В╨╛╤А╤Л╤Е ╤Б╤В╤А╨░╨╜╨╕╤Ж╨░ ╨▓╤Л╨│╨╗╤П╨┤╨╕╤В ╨╕╨╝╨╡╨╜╨╜╨╛ ╤В╨░╨║, ╨╖╨░╨┐╨╕╤Б╨░╨╜╤Л ╨▓
 // docs/node-editor.md.
-
+//
+//
+//
 // ╨в╤А╨╕ ╨▓╤Е╨╛╨┤╨░ ╤Б╨╛╤Б╤В╨░╨▓╨░, ╤Б╨▓╨╡╤А╤Е╤Г ╨▓╨╜╨╕╨╖. ╨Я╨╛╤А╤П╨┤╨╛╨║ ╨╜╨╡ ╤Б╨╗╤Г╤З╨░╨╡╨╜: ╨╝╨╡╤Б╤В╨╛ ╤Б╤Ж╨╡╨╜╤Л ╨╛╨┤╨╜╨╛ ╨╕
 // ╤З╨╕╤В╨░╨╡╤В╤Б╤П ╨┐╨╡╤А╨▓╤Л╨╝, ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╕ ╤Б╨╗╨╡╨┤╨╛╨╝, ╨┐╤А╨╡╨┤╨╝╨╡╤В╤Л ╨┐╨╛╤Б╨╗╨╡╨┤╨╜╨╕╨╝╨╕ тАФ ╤В╨░╨║ ╨╢╨╡, ╨║╨░╨║ ╨╛╨╜╨╕
 // ╤Б╤В╨╛╤П╤В ╨╜╨░ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨╡ ╤Б╤Ж╨╡╨╜╤Л.
@@ -63,13 +68,21 @@ const CAST_HANDLES = [
   { id: "plot_characters", label: "╨б╤О╨╢╨╡╤В╨╜╤Л╨╡ ╨┐╨╡╤А╤Б╨╛╨╜╨░╨╢╨╕" },
   { id: "obstacles", label: "╨Я╤А╨╡╨┐╤П╤В╤Б╤В╨▓╨╕╤П" },
   { id: "loot", label: "╨Я╨╛╤В╨╡╨╜╤Ж╨╕╨░╨╗╤М╨╜╤Л╨╣ ╨╗╤Г╤В" },
+  { id: "audio", label: "╨Р╤Г╨┤╨╕╨╛" },
+  { id: "battle", label: "╨С╨╛╨╣" },
 ] as const;
-
+//
+// ╨Ф╨╗╤П drag-n-drop ╨┐╨░╨╗╨╕╤В╤А╤Л
+const SEARCH_DRAG_MIME = "application/x-canvas-node";
+//
+//
+//
 interface SceneNodeData extends Record<string, unknown> {
   name: string;
   kind: string;
   /** ╨Т╤Л╤В╨░╤Й╨╕╤В╤М ╨╜╨░ ╤Е╨╛╨╗╤Б╤В ╤В╨╡╤Е, ╨║╤В╨╛ ╨║ ╤Б╤Ж╨╡╨╜╨╡ ╤Г╨╢╨╡ ╨┐╨╛╨┤╤Ж╨╡╨┐╨╗╨╡╨╜. */
   onPullCast: () => void;
+  onAddCheck: () => void;
   isOverride: boolean;
   campaignOnly: boolean;
   /** ╨Ш╨╝╤П ╨╖╨░╨│╨╛╤В╨╛╨▓╨║╨╕, ╨╡╤Б╨╗╨╕ ╤Н╤В╨╛ ╨╡╤Й╤С ╨╜╨╡ ╤В╤А╨╛╨╜╤Г╤В╨░╤П ╨▓╤Б╤В╨░╨▓╨║╨░. */
@@ -78,7 +91,7 @@ interface SceneNodeData extends Record<string, unknown> {
   /** ╨б╨║╨╛╨╗╤М╨║╨╛ ╤Б╤Б╤Л╨╗╨╛╨║ ╨▓╨╡╨┤╤С╤В ╨▓ ╨┤╤А╤Г╨│╨╛╨╣ ╤Б╨╡╤В╤В╨╕╨╜╨│. */
   foreignLinks: number;
 }
-
+//
 function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
   return (
     <div className={`canvas-node${selected ? " is-selected" : ""}`}>
@@ -86,7 +99,7 @@ function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
           ╨┐╨╡╤А╨╡╤Е╨╛╨┤. ╨Ъ╨▓╨░╨┤╤А╨░╤В╤Л тАФ ╤Б╨╛╤Б╤В╨░╨▓: ╨╝╨╡╤Б╤В╨╛, ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╕, ╨┐╤А╨╡╨┤╨╝╨╡╤В╤Л. ╨в╨╕╨┐ ╤А╨░╨╖╤К╤С╨╝╨░
           ╨┐╨╡╤А╨╡╨┤╨░╨╜ ╤Д╨╛╤А╨╝╨╛╨╣, ╨░ ╨╜╨╡ ╤Ж╨▓╨╡╤В╨╛╨╝: ╨▓ ╨┐╨░╨╗╨╕╤В╤А╨╡ ╤А╨╛╨▓╨╜╨╛ ╤В╤А╨╕ ╤Ж╨▓╨╡╤В╨░, ╤З╨╡╤В╨▓╤С╤А╤В╤Л╨╣
           ╨┐╨╛╨┤ ╤В╨╕╨┐╨╕╨╖╨░╤Ж╨╕╤О ╨╖╨░╨▓╨╛╨┤╨╕╤В╤М ╨╜╨╡╨╗╤М╨╖╤П (docs/design-system-punk-zine.md ┬з3.2).
-
+//
           ╨в╤А╨╕ ╨╛╤В╨┤╨╡╨╗╤М╨╜╤Л╤Е ╨▓╤Е╨╛╨┤╨░, ╨░ ╨╜╨╡ ╨╛╨┤╨╕╨╜ ╤Г╨╝╨╜╤Л╨╣: ╤Б╤Г╤Й╨╡╤Б╤В╨▓╨╛ ╨▒╤Л╨▓╨░╨╡╤В ╨╕ ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨╝,
           ╨╕ ╨╛╨▒╤Б╤В╨░╨╜╨╛╨▓╨║╨╛╨╣ (┬л╨▓ ╤Г╨│╨╗╤Г ╤Б╨┐╨╕╤В ╨┤╤А╨░╨║╨╛╨╜, ╨▒╤Г╨┤╨╕╤В╤М ╨╜╨╡ ╨╜╨░╨┤╨╛┬╗), ╨░ ╨╗╨╛╨║╨░╤Ж╨╕╤П тАФ ╨╕
           ╨╝╨╡╤Б╤В╨╛╨╝ ╤Б╤Ж╨╡╨╜╤Л, ╨╕ ╨┐╤А╨╡╨┤╨╝╨╡╤В╨╛╨╝ ╤А╨░╨╖╨│╨╛╨▓╨╛╤А╨░. ╨а╨╛╨╗╤М ╨╛╨┐╤А╨╡╨┤╨╡╨╗╤П╨╡╤В ╤А╨░╨╖╤К╤С╨╝, ╨░ ╨╜╨╡
@@ -105,7 +118,7 @@ function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
           id={h.id}
           position={Position.Left}
           style={{ top: 44 + i * 20 }}
-          className="canvas-handle--entity"
+          className={`canvas-handle--entity canvas-handle--${h.id}`}
           title={h.label}
         />
       ))}
@@ -135,9 +148,14 @@ function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
             ╤Б╤З╨╕╤В╨░╨╡╤В╤Б╤П ╨╝╨╕╨╜╤Г╤Б╨╛╨╝, ╨░ ╨╜╨░ ╤Б╤Е╨╡╨╝╨╡ ╨╕╨╖ ╤В╤А╨╕╨┤╤Ж╨░╤В╨╕ ╤Б╤Ж╨╡╨╜ ╤В╤А╨╕╨┤╤Ж╨░╤В╤М ╨║╨╜╨╛╨┐╨╛╨║ тАФ
             ╤Н╤В╨╛ ╤И╤Г╨╝, ╨║╨╛╤В╨╛╤А╤Л╨╣ ╤З╨╕╤В╨░╨╡╤В╤Б╤П ╤А╨░╨╜╤М╤И╨╡ ╨╕╨╝╤С╨╜. */}
         {selected && (
-          <button className="nodrag canvas-node__action" onClick={data.onPullCast}>
-            ╨Т╤Л╤В╨░╤Й╨╕╤В╤М ╤Б╨╛╤Б╤В╨░╨▓
-          </button>
+          <div className="stack" style={{ gap: 4 }}>
+            <button className="nodrag canvas-node__action" onClick={data.onPullCast}>
+              ╨Т╤Л╤В╨░╤Й╨╕╤В╤М ╤Б╨╛╤Б╤В╨░╨▓
+            </button>
+            <button className="nodrag canvas-node__action" onClick={data.onAddCheck}>
+              + ╨Я╤А╨╛╨▓╨╡╤А╨║╨░
+            </button>
+          </div>
         )}
       </div>
       {/* ╨б╨┐╤А╨░╨▓╨░ ╨▓╤Л╤В╨╡╨║╨░╨╡╤В ╤В╨╛, ╤З╤В╨╛ ╨╕╨╖ ╤Б╤Ж╨╡╨╜╤Л ╤Б╨╗╨╡╨┤╤Г╨╡╤В: ╤Е╨╛╨┤ ╨╕╤Б╤В╨╛╤А╨╕╨╕ (╤А╨╛╨╝╨▒) ╨╕ ╤Б╨╗╨╡╨┤
@@ -155,18 +173,19 @@ function SceneNode({ data, selected }: NodeProps<Node<SceneNodeData>>) {
         id="consequences"
         position={Position.Right}
         style={{ top: 44 }}
-        className="canvas-handle--entity"
+        className="canvas-handle--entity canvas-handle--consequences"
         title="╨Я╨╛╤Б╨╗╨╡╨┤╤Б╤В╨▓╨╕╤П"
       />
     </div>
   );
 }
-
+//
+//
 // ╨Э╨╛╨┤╤Л ╤Б╤Г╤Й╨╜╨╛╤Б╤В╨╡╨╣ ╨╕ ╨╜╨░╨▒╨╛╤А╨╛╨▓. ╨Ф╨░╨╜╨╜╤Л╨╡ ╤В╨╡╨║╤Г╤В ╨б╨Ы╨Х╨Т╨Р ╨Э╨Р╨Я╨а╨Р╨Т╨Ю: ╤Г ╤Б╤Ж╨╡╨╜╤Л ╤Б╨╗╨╡╨▓╨░ ╤В╨╛, ╨╕╨╖
 // ╤З╨╡╨│╨╛ ╨╛╨╜╨░ ╤Б╨╛╨▒╤А╨░╨╜╨░ (╨╝╨╡╤Б╤В╨╛, ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╕, ╨┐╤А╨╡╨┤╨╝╨╡╤В╤Л), ╤Б╨┐╤А╨░╨▓╨░ тАФ ╤З╤В╨╛ ╨╕╨╖ ╨╜╨╡╤С ╤Б╨╗╨╡╨┤╤Г╨╡╤В.
 // ╨б╤Г╤Й╨╜╨╛╤Б╤В╤М ╨┐╨╛╤Н╤В╨╛╨╝╤Г ╨╕╨╝╨╡╨╡╤В ╤В╨╛╨╗╤М╨║╨╛ ╨▓╤Л╤Е╨╛╨┤: ╨╛╨╜╨░ ╨▓╤В╨╡╨║╨░╨╡╤В ╨▓ ╤Б╤Ж╨╡╨╜╤Г, ╨░ ╨╜╨╡ ╨╜╨░╨╛╨▒╨╛╤А╨╛╤В тАФ
 // ╨╛╨▒╤А╨░╤В╨╜╨╛╨╡ ╨╜╨░╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╨╡ ╤З╨╕╤В╨░╨╗╨╛╤Б╤М ╨▒╤Л ╨║╨░╨║ ┬л╤Б╤Ж╨╡╨╜╨░ ╨┐╨╛╤А╨╛╨╢╨┤╨░╨╡╤В ╨│╨╛╨▒╨╗╨╕╨╜╨░┬╗.
-
+//
 interface EntityNodeData extends Record<string, unknown> {
   name: string;
   kind: string | null;
@@ -174,7 +193,7 @@ interface EntityNodeData extends Record<string, unknown> {
   thumbUrl: string | null;
   mentionedIn: number;
 }
-
+//
 // ╨Я╨╛╨┤╨┐╨╕╤Б╨╕ ╨▓╨╕╨┤╨╛╨▓ тАФ ╤В╨╛╨╗╤М╨║╨╛ ╤В╨░╨╝, ╨│╨┤╨╡ ╨▓╨╕╨┤ ╤З╤В╨╛-╤В╨╛ ╨┤╨╛╨▒╨░╨▓╨╗╤П╨╡╤В ╨║ ╨╕╨╝╨╡╨╜╨╕. ╨г ╨╗╨╛╨║╨░╤Ж╨╕╨╕ ╨╕
 // ╨┐╤А╨╡╨┤╨╝╨╡╤В╨░ ╨╛╨╜ ╤Б╨╛╨▓╨┐╨░╨┤╨░╨╡╤В ╤Б ╤Б╨░╨╝╨╛╨╣ ╨╜╨╛╨┤╨╛╨╣ ╨╕ ╨┐╤А╨╡╨▓╤А╨░╤В╨╕╨╗╤Б╤П ╨▒╤Л ╨▓ ╤И╤Г╨╝.
 const ENTITY_TYPE_LABEL: Record<string, string> = {
@@ -183,11 +202,14 @@ const ENTITY_TYPE_LABEL: Record<string, string> = {
   artifact: "╨Я╤А╨╡╨┤╨╝╨╡╤В",
   community: "╨б╨╛╨╛╨▒╤Й╨╡╤Б╤В╨▓╨╛",
   compendium_entry: "╨Ш╨╖ ╨║╨╜╨╕╨│╨╕",
+  sound_set: "╨Ч╨▓╤Г╨║",
+  playlist: "╨Я╨╗╨╡╨╣╨╗╨╕╤Б╤В",
 };
-
+//
 function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
+  const cls = `canvas-node canvas-node--entity canvas-node--${data.nodeType}${selected ? " is-selected" : ""}`;
   return (
-    <div className={`canvas-node canvas-node--entity${selected ? " is-selected" : ""}`}>
+    <div className={cls}>
       <div className="canvas-node__band">
         {/* ╨Я╨╛╤А╤В╤А╨╡╤В тАФ ╤Б╨░╨╝╤Л╨╣ ╨▒╤Л╤Б╤В╤А╤Л╨╣ ╨╛╨┐╨╛╨╖╨╜╨░╨▓╨░╤В╨╡╨╗╤М╨╜╤Л╨╣ ╨╖╨╜╨░╨║: ╨╖╨░ ╤Б╤В╨╛╨╗╨╛╨╝ ╨╜╨╛╨┤╤Г
             ╨╛╨┐╨╛╨╖╨╜╨░╤О╤В, ╨░ ╨╜╨╡ ╤З╨╕╤В╨░╤О╤В. */}
@@ -215,11 +237,12 @@ function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
       </div>
       {/* ╨Ъ╨▓╨░╨┤╤А╨░╤В тАФ ╤Б╤Г╤Й╨╜╨╛╤Б╤В╤М, ╤А╨╛╨╝╨▒ тАФ ╨╕╤Б╤В╨╛╤А╨╕╤П. ╨в╨╕╨┐ ╤А╨░╨╖╤К╤С╨╝╨░ ╨┐╨╡╤А╨╡╨┤╨░╨╜ ╤Д╨╛╤А╨╝╨╛╨╣, ╨░ ╨╜╨╡
           ╤Ж╨▓╨╡╤В╨╛╨╝: ╨▓ ╨┐╨░╨╗╨╕╤В╤А╨╡ ╤А╨╛╨▓╨╜╨╛ ╤В╤А╨╕ ╤Ж╨▓╨╡╤В╨░. */}
-      <Handle type="source" position={Position.Right} className="canvas-handle--entity" />
+      <Handle type="source" position={Position.Right} className={`canvas-handle--entity canvas-handle--${data.nodeType}`} />
     </div>
   );
 }
-
+//
+//
 interface BundleNodeData extends Record<string, unknown> {
   name: string;
   contentType: string | null;
@@ -227,11 +250,11 @@ interface BundleNodeData extends Record<string, unknown> {
   fromLibrary: boolean;
   inLibrary: boolean;
 }
-
+//
 function BundleNode({ data, selected }: NodeProps<Node<BundleNodeData>>) {
   return (
     <div className={`canvas-node canvas-node--bundle${selected ? " is-selected" : ""}`}>
-      <Handle type="target" position={Position.Left} id="members" className="canvas-handle--entity" />
+      <Handle type="target" position={Position.Left} id="members" className="canvas-handle--entity canvas-handle--members" />
       <div className="canvas-node__band">
         <span className="canvas-node__name">{data.name || "╨Э╨░╨▒╨╛╤А"}</span>
         <span className="canvas-node__kind">╨Э╨░╨▒╨╛╤А</span>
@@ -256,18 +279,19 @@ function BundleNode({ data, selected }: NodeProps<Node<BundleNodeData>>) {
           {data.inLibrary && <span className="canvas-node__chip is-solid">╨Э╨░ ╨┐╨╛╨╗╨║╨╡</span>}
         </div>
       </div>
-      <Handle type="source" position={Position.Right} className="canvas-handle--entity" />
+      <Handle type="source" position={Position.Right} className="canvas-handle--entity canvas-handle--members" />
     </div>
   );
 }
-
+//
+//
 interface EventNodeData extends Record<string, unknown> {
   title: string;
   date: string;
   status: EventStatus;
   important: boolean;
 }
-
+//
 // ╨Э╨╛╨┤╨░ ╤Б╨╛╨▒╤Л╤В╨╕╤П. ╨Ю╨┐╨╛╨╖╨╜╨░╤С╤В╤Б╤П, ╨░ ╨╜╨╡ ╤З╨╕╤В╨░╨╡╤В╤Б╤П: ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╡, ╨┤╨░╤В╨░ ╨┐╨╛-╤З╨╡╨╗╨╛╨▓╨╡╤З╨╡╤Б╨║╨╕ ╨╕
 // ╤Б╤В╨░╤В╤Г╤Б. ╨Ю╨┐╨╕╤Б╨░╨╜╨╕╨╡ ╨╢╨╕╨▓╤С╤В ╨▓ ╨┐╤А╨╛╤Д╨╕╨╗╨╡ ╤Б╨╛╨▒╤Л╤В╨╕╤П тАФ ╨╜╨░ ╤Б╤Е╨╡╨╝╨╡ ╨╛╨╜╨╛ ╤Б╤К╨╡╨╗╨╛ ╨▒╤Л ╨╝╨╡╤Б╤В╨╛ ╤Г
 // ╨╕╨╝╤С╨╜ ╤Б╨╛╤Б╨╡╨┤╨╡╨╣.
@@ -276,7 +300,7 @@ function EventNode({ data, selected }: NodeProps<Node<EventNodeData>>) {
     <div className={`canvas-node canvas-node--event${selected ? " is-selected" : ""}`}>
       {/* ╨б╨╛╨▒╤Л╤В╨╕╨╡ тАФ ╨╡╨┤╨╕╨╜╤Б╤В╨▓╨╡╨╜╨╜╨░╤П ╨╜╨╛╨┤╨░, ╤Г ╨║╨╛╤В╨╛╤А╨╛╨╣ ╨▓╤Е╨╛╨┤ ╨б╨Я╨а╨Р╨Т╨Р ╨╜╨╡╤З╨╡╨│╨╛ ╨▒╤Л╨╗╨╛ ╨▒╤Л
           ╨┤╨╡╨╗╨░╤В╤М: ╨┐╨╛╤Б╨╗╨╡╨┤╤Б╤В╨▓╨╕╨╡ ╨▓╤В╨╡╨║╨░╨╡╤В ╨▓ ╨╜╨╡╨│╨╛ ╤Б╨╗╨╡╨▓╨░, ╨╛╤В ╤Б╤Ж╨╡╨╜╤Л. */}
-      <Handle type="target" position={Position.Left} id="in" className="canvas-handle--entity" />
+      <Handle type="target" position={Position.Left} id="in" className="canvas-handle--entity canvas-handle--in" />
       <div className="canvas-node__band">
         {/* ╨Ю╤В╨╝╨╡╨╜╤С╨╜╨╜╨╛╨╡ тАФ ╨╖╨░╤З╤С╤А╨║╨╜╤Г╤В╤Л╨╝: ╤Н╤В╨╛ ╨╡╨┤╨╕╨╜╤Б╤В╨▓╨╡╨╜╨╜╤Л╨╣ ╤Б╤В╨░╤В╤Г╤Б, ╨╝╨╡╨╜╤П╤О╤Й╨╕╨╣ ╤Б╨╝╤Л╤Б╨╗
             ╨▓╤Б╨╡╨╣ ╨╜╨╛╨┤╤Л, ╨╕ ╤А╨░╨╖╨╗╨╕╤З╨░╤В╤М ╨╡╨│╨╛ ╨┐╨╛ ╨╝╨╡╨╗╨║╨╛╨╝╤Г ╤Б╨╗╨╛╨▓╤Г ╨╖╨░ ╤Б╤В╨╛╨╗╨╛╨╝ ╨╜╨╡ ╨▓╤Л╨╣╨┤╨╡╤В. */}
@@ -297,7 +321,198 @@ function EventNode({ data, selected }: NodeProps<Node<EventNodeData>>) {
     </div>
   );
 }
-
+//
+//
+interface CheckNodeData extends Record<string, unknown> {
+  what: string;
+  difficulty: string;
+  outcomes: { id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[];
+}
+//
+function CheckNode({ data, selected }: NodeProps<Node<CheckNodeData>>) {
+  return (
+    <div className={`canvas-node canvas-node--check${selected ? " is-selected" : ""}`}>
+      <Handle type="target" position={Position.Left} id="check_in" className="canvas-handle--entity" />
+      <div className="canvas-node__band">
+        <span className="canvas-node__name">{data.what || "╨Я╤А╨╛╨▓╨╡╤А╨║╨░"}</span>
+        {data.difficulty && <span className="canvas-node__kind">{data.difficulty}</span>}
+      </div>
+      <div className="canvas-node__body">
+        <div className="stack" style={{ gap: 4 }}>
+          {data.outcomes.map((o) => (
+            <div key={o.id} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
+              <span className="canvas-node__member" style={{ fontSize: "var(--fs-micro)" }}>{o.label || "╨Ш╤Б╤Е╨╛╨┤"}</span>
+              <Handle
+                type="source"
+                id={`outcome:${o.id}`}
+                position={Position.Right}
+                className="canvas-handle--story"
+                title={o.label}
+              />
+            </div>
+          ))}
+          {data.outcomes.length === 0 && (
+            <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>╨Э╨╡╤В ╨╕╤Б╤Е╨╛╨┤╨╛╨▓</span>
+          )}
+        </div>
+      </div>
+    </div>
+  );
+}
+//
+interface AdventureNodeData extends Record<string, unknown> {
+  name: string;
+  onDrillDown: () => void;
+}
+//
+function AdventureNode({ data, selected }: NodeProps<Node<AdventureNodeData>>) {
+  return (
+    <div
+      className={`canvas-node${selected ? " is-selected" : ""}`}
+      onDoubleClick={data.onDrillDown}
+      title="╨Ф╨▓╨╛╨╣╨╜╨╛╨╣ ╨║╨╗╨╕╨║ тАФ ╨╛╤В╨║╤А╤Л╤В╤М ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡"
+    >
+      <Handle type="target" position={Position.Left} id="story" className="canvas-handle--story" />
+      <div className="canvas-node__band">
+        <span className="canvas-node__name">{data.name}</span>
+        <span className="canvas-node__kind">╨Я╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡</span>
+      </div>
+      <div className="canvas-node__body">
+        <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>╨Ф╨▓╨╛╨╣╨╜╨╛╨╣ ╨║╨╗╨╕╨║ тАФ ╨▓╨╜╤Г╤В╤А╤М</span>
+      </div>
+      <Handle type="source" position={Position.Right} id="story" className="canvas-handle--story" />
+    </div>
+  );
+}
+//
+const STICKER_COLORS: Record<string, string> = {
+  paper: "#F2E8C6",
+  blue: "#DDE8F0",
+  green: "#D8E8D8",
+  pink: "#F0DDE8",
+  beige: "#E8DDD0",
+  gray: "#E0E0E8",
+};
+//
+interface StickerNodeData extends Record<string, unknown> {
+  text: string;
+  name: string;
+  note: string;
+  color: string;
+}
+//
+function StickerNode({ data, selected }: NodeProps<Node<StickerNodeData>>) {
+  const bg = STICKER_COLORS[data.color] ?? STICKER_COLORS.paper;
+  return (
+    <div
+      className={`canvas-node canvas-node--sticker${selected ? " is-selected" : ""}`}
+      style={{ background: bg, width: 320, minHeight: 120, borderColor: "var(--line)", boxShadow: "0 1px 0 rgba(18,16,14,0.06)" }}
+    >
+      <div className="canvas-node__body">
+        <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-body)", whiteSpace: "pre-wrap" }}>{data.name || data.text}</div>
+        {data.note && <div className="muted" style={{ fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap" }}>{data.note}</div>}
+      </div>
+    </div>
+  );
+}
+//
+interface ImageNodeData extends Record<string, unknown> {
+  file_url: string;
+  w: number;
+  h: number;
+}
+//
+function ImageNode({ data, selected }: NodeProps<Node<ImageNodeData>>) {
+  return (
+    <div className={`canvas-node canvas-node--image${selected ? " is-selected" : ""}`} style={{ width: 320, padding: 0, overflow: "hidden" }}>
+      <img src={data.file_url} alt="" style={{ width: "100%", height: 240, objectFit: "contain", display: "block" }} />
+    </div>
+  );
+}
+//
+interface FrameNodeData extends Record<string, unknown> {
+  name: string;
+  color: string;
+  w: number;
+  h: number;
+  isHighlighted: boolean;
+  onRename: (next: string) => void;
+}
+//
+function FrameNode({ data, selected }: NodeProps<Node<FrameNodeData>>) {
+  const [editing, setEditing] = useState(false);
+  const [draft, setDraft] = useState(data.name);
+  useEffect(() => setDraft(data.name), [data.name]);
+  const highlighted = data.isHighlighted || selected;
+  return (
+    <div className={`canvas-frame${highlighted ? " is-highlighted" : ""}`} style={{ borderColor: data.color }}>
+      <NodeResizer minWidth={200} minHeight={120} isVisible={selected} />
+      {/* ╨Ч╨░╨│╨╛╨╗╨╛╨▓╨╛╨║ тАФ ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╨╜╨╕╨╡ ╨▓ ╨╛╨┤╨╕╨╜ ╨║╨╗╨╕╨║, ╨║╨░╨║ ╨┐╤А╨╛╤Б╨╕╨╗╨╕. ╨С╨╡╨╖ ╨╝╨╛╨┤╨░╨╗╨║╨╕: ╨║╨╗╨╕╨║ тАФ ╨┐╨╛╨╗╨╡, Enter тАФ ╤Б╨╛╤Е╤А╨░╨╜╨╕╤В╤М. */}
+      {editing ? (
+        <input
+          className="canvas-frame__title"
+          value={draft}
+          autoFocus
+          onChange={(e) => setDraft(e.target.value)}
+          onBlur={() => {
+            const next = draft.trim() || "╨У╤А╤Г╨┐╨┐╨░";
+            setEditing(false);
+            if (next !== data.name) data.onRename(next);
+          }}
+          onKeyDown={(e) => {
+            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
+            if (e.key === "Escape") { setDraft(data.name); setEditing(false); }
+          }}
+          style={{ minWidth: 120 }}
+        />
+      ) : (
+        <div className="canvas-frame__title" onClick={() => setEditing(true)} title="╨Э╨░╨╢╨╝╨╕╤В╨╡, ╤З╤В╨╛╨▒╤Л ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╤В╤М">
+          {data.name}
+        </div>
+      )}
+    </div>
+  );
+}
+//
+interface SoundSetNodeData extends Record<string, unknown> {
+  name: string;
+  battle_playlist_id: number | null;
+}
+//
+function SoundSetNode({ data, selected }: NodeProps<Node<SoundSetNodeData>>) {
+  return (
+    <div className={`canvas-node canvas-node--sound_set${selected ? " is-selected" : ""}`}>
+      <div className="canvas-node__band">
+        <span className="canvas-node__name">{data.name}</span>
+        <span className="canvas-node__kind">╨Ч╨▓╤Г╨║</span>
+      </div>
+      <div className="canvas-node__body">
+        <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>╨в╨╛╨╗╤М╨║╨╛ ╨▓ ┬л╨Р╤Г╨┤╨╕╨╛┬╗</span>
+      </div>
+      <Handle type="source" position={Position.Right} className="canvas-handle--entity canvas-handle--audio" />
+    </div>
+  );
+}
+//
+interface PlaylistNodeData extends Record<string, unknown> {
+  name: string;
+}
+//
+function PlaylistNode({ data, selected }: NodeProps<Node<PlaylistNodeData>>) {
+  return (
+    <div className={`canvas-node canvas-node--playlist${selected ? " is-selected" : ""}`}>
+      <div className="canvas-node__band">
+        <span className="canvas-node__name">{data.name}</span>
+        <span className="canvas-node__kind">╨Я╨╗╨╡╨╣╨╗╨╕╤Б╤В</span>
+      </div>
+      <div className="canvas-node__body">
+        <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>╨в╨╛╨╗╤М╨║╨╛ ╨▓ ┬л╨С╨╛╨╣┬╗</span>
+      </div>
+      <Handle type="source" position={Position.Right} className="canvas-handle--entity canvas-handle--battle" />
+    </div>
+  );
+}
+//
 /**
  * ╨а╨░╨╝╨║╨░ ╨│╨╗╨░╨▓╤Л.
  *
@@ -311,16 +526,45 @@ function EventNode({ data, selected }: NodeProps<Node<EventNodeData>>) {
  */
 interface ChapterNodeData extends Record<string, unknown> {
   name: string;
+  color: string;
+  isHighlighted: boolean;
+  onRename: (next: string) => void;
 }
-
-function ChapterNode({ data }: NodeProps<Node<ChapterNodeData>>) {
+//
+function ChapterNode({ data, selected }: NodeProps<Node<ChapterNodeData>>) {
+  const [editing, setEditing] = useState(false);
+  const [draft, setDraft] = useState(data.name);
+  useEffect(() => setDraft(data.name), [data.name]);
+  const highlighted = data.isHighlighted || selected;
   return (
-    <div className="canvas-frame">
-      <div className="canvas-frame__title">{data.name}</div>
+    <div className={`canvas-frame${highlighted ? " is-highlighted" : ""}`} style={{ borderColor: data.color }}>
+      <NodeResizer minWidth={300} minHeight={200} isVisible={selected} />
+      {editing ? (
+        <input
+          className="canvas-frame__title"
+          value={draft}
+          autoFocus
+          onChange={(e) => setDraft(e.target.value)}
+          onBlur={() => {
+            const next = draft.trim() || "╨У╨╗╨░╨▓╨░";
+            setEditing(false);
+            if (next !== data.name) data.onRename(next);
+          }}
+          onKeyDown={(e) => {
+            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
+            if (e.key === "Escape") { setDraft(data.name); setEditing(false); }
+          }}
+        />
+      ) : (
+        <div className="canvas-frame__title" onClick={() => setEditing(true)} title="╨Э╨░╨╢╨╝╨╕╤В╨╡, ╤З╤В╨╛╨▒╤Л ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╤В╤М">
+          {data.name}
+        </div>
+      )}
     </div>
   );
 }
-
+//
+//
 // Module-level: React Flow ╤Б╤А╨░╨▓╨╜╨╕╨▓╨░╨╡╤В nodeTypes ╨┐╨╛ ╤Б╤Б╤Л╨╗╨║╨╡ ╨╕ ╨┐╨╡╤А╨╡╤Б╤В╤А╨░╨╕╨▓╨░╨╡╤В ╨▓╤Б╤С
 // ╨┤╨╡╤А╨╡╨▓╨╛ ╨╜╨╛╨┤, ╨╡╤Б╨╗╨╕ ╨╛╨▒╤К╨╡╨║╤В ╨╜╨╛╨▓╤Л╨╣ ╨╜╨░ ╨║╨░╨╢╨┤╤Л╨╣ ╤А╨╡╨╜╨┤╨╡╤А.
 const NODE_TYPES = {
@@ -329,49 +573,75 @@ const NODE_TYPES = {
   bundle: BundleNode,
   event: EventNode,
   chapter: ChapterNode,
+  frame: FrameNode,
+  check: CheckNode,
+  adventure: AdventureNode,
+  sticker: StickerNode,
+  image: ImageNode,
+  sound_set: SoundSetNode,
+  playlist: PlaylistNode,
 };
-
+//
 const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
-
+//
 const EDGE_CLASS: Record<string, string | undefined> = {
   transition: undefined,
+  arc_transition: undefined,
   outcome: "canvas-edge--outcome",
   cast: "canvas-edge--cast",
   member: "canvas-edge--cast",
+  check: "canvas-edge--cast",
 };
-
+//
 type CanvasNodeData =
   | SceneNodeData
   | EntityNodeData
   | BundleNodeData
   | EventNodeData
-  | ChapterNodeData;
-
+  | ChapterNodeData
+  | FrameNodeData
+  | CheckNodeData
+  | AdventureNodeData
+  | StickerNodeData
+  | ImageNodeData
+  | SoundSetNodeData
+  | PlaylistNodeData;
+//
 /** ╨а╨░╨╝╨║╨╕ ╨╗╨╡╨╢╨░╤В ╨▓ ╤В╨╛╨╝ ╨╢╨╡ ╨╝╨░╤Б╤Б╨╕╨▓╨╡ ╨╜╨╛╨┤ тАФ ╨╛╤В╨╗╨╕╤З╨░╤В╤М ╨╕╤Е ╨╜╨░╨┤╨╛ ╨┐╨╛ ╨║╨╗╤О╤З╤Г. */
 function isFrame(id: string): boolean {
-  return id.startsWith("chapter:");
+  return id.startsWith("chapter:") || id.startsWith("frame:");
 }
-
+//
 /** ┬лbeing:41┬╗ тЖТ ["being", 41]. ╨Ъ╨╗╤О╤З ╨╜╨╛╨┤╤Л ╨┐╤А╨╕╤Е╨╛╨┤╨╕╤В ╤Б ╤Б╨╡╤А╨▓╨╡╤А╨░ ╤Б╤В╤А╨╛╨║╨╛╨╣. */
 function splitKey(key: string): [string, number] {
   const at = key.indexOf(":");
   return [key.slice(0, at), Number(key.slice(at + 1))];
 }
-
+//
+//
 // ╨Ю╨┤╨╜╨░ ╨╜╨╛╨┤╨░ ╤Е╨╛╨╗╤Б╤В╨░ тЖТ ╨╜╨╛╨┤╨░ React Flow. ╨Ъ╨╗╤О╤З ╨┐╤А╨╕╤Е╨╛╨┤╨╕╤В ╤Б ╤Б╨╡╤А╨▓╨╡╤А╨░ ╤Б╤В╤А╨╛╨║╨╛╨╣
 // ┬л╨▓╨╕╨┤:╨╜╨╛╨╝╨╡╤А┬╗: ╨│╨╛╨╗╨╛╨│╨╛ ╨╜╨╛╨╝╨╡╤А╨░ ╨╝╨░╨╗╨╛ ╤Б ╤В╨╡╤Е ╨┐╨╛╤А, ╨║╨░╨║ ╤А╤П╨┤╨╛╨╝ ╤Б╨╛ ╤Б╤Ж╨╡╨╜╨░╨╝╨╕ ╤Б╤В╨╛╤П╤В
 // ╤Б╤Г╤Й╨╡╤Б╤В╨▓╨░ тАФ ╤Б╤Ж╨╡╨╜╨░ 41 ╨╕ ╤Б╤Г╤Й╨╡╤Б╤В╨▓╨╛ 41 ╨┐╨╛╨╗╤Г╤З╨╕╨╗╨╕ ╨▒╤Л ╨╛╨┤╨╕╨╜ ╨║╨╗╤О╤З.
 function toFlowNode(
   n: CanvasAnyNode,
-  onPullCast: (sceneId: number) => void,
-  months: CalendarMonth[],
-  era: string
+  ctx: {
+    onPullCast: (sceneId: number) => void;
+    onAddCheck: (sceneId: number) => void;
+    onDrillDown: (arcId: number) => void;
+    highlightedFrameId: number | null;
+    onRenameFrame: (id: number, next: string) => void;
+    onRenameChapter: (arcId: number, next: string) => void;
+    months: CalendarMonth[];
+    era: string;
+  }
 ): Node<CanvasNodeData> {
-  const base = { id: n.key, position: { x: n.x, y: n.y } };
+  const base = { id: n.key, position: { x: n.x, y: n.y } } as const;
+  const zIndex = (n as unknown as { z_index?: number }).z_index ?? 0;
   if (n.node_type === "bundle") {
     return {
       ...base,
       type: "bundle",
+      zIndex,
       data: {
         name: n.bundle.name,
         contentType: n.bundle.content_type,
@@ -381,13 +651,108 @@ function toFlowNode(
       },
     };
   }
+  if (n.node_type === "adventure") {
+    return {
+      ...base,
+      type: "adventure",
+      zIndex,
+      data: {
+        name: n.adventure.name,
+        onDrillDown: () => ctx.onDrillDown(n.node_id),
+      },
+    };
+  }
+  if (n.node_type === "sticker") {
+    return {
+      ...base,
+      type: "sticker",
+      zIndex,
+      width: 320,
+      height: 120,
+      data: {
+        text: n.sticker.text,
+        name: n.sticker.name,
+        note: n.sticker.note,
+        color: n.sticker.color,
+      },
+    };
+  }
+  if (n.node_type === "image") {
+    return {
+      ...base,
+      type: "image",
+      zIndex,
+      width: n.image.w,
+      height: n.image.h,
+      data: {
+        file_url: n.image.file_url,
+        w: n.image.w,
+        h: n.image.h,
+      },
+    };
+  }
+  if (n.node_type === "frame") {
+    return {
+      ...base,
+      type: "frame",
+      zIndex,
+      width: n.frame.w,
+      height: n.frame.h,
+      // ╨а╨░╨╝╨║╤Г ╤Б ╤Е╨╛╨╗╤Б╤В╨░ ╨╜╨╡ ╤Г╨┤╨░╨╗╤П╤О╤В ╨┐╤А╨╛╤Б╤В╨╛: ╨╛╨╜╨░ тАФ ╨│╤А╤Г╨┐╨┐╨╕╤А╨╛╨▓╨║╨░, ╨╕ Delete
+      // ╨╜╨░╨┤ ╨║╨▓╨░╨┤╤А╨░╤В╨╕╨║╨░╨╝╨╕ ╨╜╨╡ ╨╖╨╜╨░╤З╨╕╤В ┬л╤А╨░╤Б╤Д╨╛╤А╨╝╨╕╤А╨╛╨▓╨░╤В╤М ╨│╤А╤Г╨┐╨┐╤Г┬╗ ╨▒╨╡╨╖ ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П.
+      deletable: true,
+      dragHandle: ".canvas-frame__title",
+      data: {
+        name: n.frame.name,
+        color: n.frame.color,
+        w: n.frame.w,
+        h: n.frame.h,
+        isHighlighted: ctx.highlightedFrameId === n.node_id,
+        onRename: (next: string) => ctx.onRenameFrame(n.node_id, next),
+      },
+    };
+  }
+  if (n.node_type === "sound_set") {
+    return {
+      ...base,
+      type: "sound_set",
+      zIndex,
+      data: {
+        name: n.sound_set.name,
+        battle_playlist_id: n.sound_set.battle_playlist_id,
+      },
+    };
+  }
+  if (n.node_type === "playlist") {
+    return {
+      ...base,
+      type: "playlist",
+      zIndex,
+      data: {
+        name: n.playlist.name,
+      },
+    };
+  }
+  if (n.node_type === "check") {
+    return {
+      ...base,
+      type: "check",
+      zIndex,
+      data: {
+        what: n.check.what,
+        difficulty: n.check.difficulty,
+        outcomes: n.check.outcomes,
+      },
+    };
+  }
   if (n.node_type === "setting_event" || n.node_type === "campaign_event") {
     return {
       ...base,
       type: "event",
+      zIndex,
       data: {
         title: n.event.title,
-        date: formatByPrecision(n.event.year, n.event.month, n.event.day, n.event.precision, months, era),
+        date: formatByPrecision(n.event.year, n.event.month, n.event.day, n.event.precision, ctx.months, ctx.era),
         status: n.event.status,
         important: n.event.important,
       },
@@ -397,6 +762,7 @@ function toFlowNode(
     return {
       ...base,
       type: "scene",
+      zIndex,
       // ╨б╤Ж╨╡╨╜╤Г ╤Б ╤Е╨╛╨╗╤Б╤В╨░ ╨╜╨╡ ╤Г╨┤╨░╨╗╤П╤О╤В: ╨╛╨╜╨░ ╨▓╤Л╨▓╨╛╨┤╨╕╤В╤Б╤П ╨╕╨╖ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П, ╨╕ ┬л╤Г╨┤╨░╨╗╨╕╤В╤М┬╗
       // ╨╖╨┤╨╡╤Б╤М ╨╛╨╖╨╜╨░╤З╨░╨╗╨╛ ╨▒╤Л ╨╛╤В╨┐╤А╨░╨▓╨╕╤В╤М ╨╡╤С ╨▓ ╨░╤А╤Е╨╕╨▓ тАФ ╤З╨╡╨│╨╛ ╨Ь╨░╤Б╤В╨╡╤А, ╨┤╨▓╨╕╨│╨░╤П
       // ╨║╨▓╨░╨┤╤А╨░╤В╨╕╨║╨╕ ╨╕ ╨╜╨░╨╢╨╕╨╝╨░╤П Delete, ╨╜╨╡ ╨╕╨╝╨╡╨╗ ╨▓ ╨▓╨╕╨┤╤Г.
@@ -409,7 +775,8 @@ function toFlowNode(
         libraryName: n.scene.library_name,
         inLibrary: n.scene.in_library,
         foreignLinks: n.scene.foreign_links,
-        onPullCast: () => onPullCast(n.scene.id),
+        onPullCast: () => ctx.onPullCast(n.scene.id),
+        onAddCheck: () => ctx.onAddCheck(n.scene.id),
       },
     };
   }
@@ -419,6 +786,7 @@ function toFlowNode(
   return {
     ...base,
     type: "entity",
+    zIndex,
     data: {
       name: n.entity.name,
       kind: n.entity.kind,
@@ -428,9 +796,9 @@ function toFlowNode(
     },
   };
 }
-
+//
 /** ╨а╨░╨╝╨║╨░ ╨│╨╗╨░╨▓╤Л тЖТ ╨╜╨╛╨┤╨░ React Flow. ╨Ы╨╛╨╢╨╕╤В╤Б╤П ╨┐╨╛╨┤ ╤Б╤Ж╨╡╨╜╤Л ╨╕ ╤В╨░╤Й╨╕╤В╤Б╤П ╨╖╨░ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨╛╨║. */
-function toFrameNode(g: CanvasGroup): Node<CanvasNodeData> {
+function toFrameNode(g: CanvasGroup, highlightedFrameId: number | null, onRenameChapter: (arcId: number, next: string) => void): Node<CanvasNodeData> {
   return {
     id: `chapter:${g.arc_id}`,
     type: "chapter",
@@ -446,28 +814,40 @@ function toFrameNode(g: CanvasGroup): Node<CanvasNodeData> {
     // ╨Э╨╕╨╢╨╡ ╤Б╤Ж╨╡╨╜ ╤А╨░╨╝╨║╨░ ╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П ╨┐╨╛╤А╤П╨┤╨║╨╛╨╝ ╨▓ ╨╝╨░╤Б╤Б╨╕╨▓╨╡, ╨░ ╨╜╨╡ ╨╛╤В╤А╨╕╤Ж╨░╤В╨╡╨╗╤М╨╜╤Л╨╝
     // z-index: ╨┐╤А╨╕ zIndex: -1 ╨╜╨╛╨┤╨░ ╤Г╤Е╨╛╨┤╨╕╤В ╨Ч╨Р ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨╕ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨╛╨║ ╨┐╨╡╤А╨╡╤Б╤В╨░╤С╤В
     // ╨╗╨╛╨▓╨╕╤В╤М ╨╝╤Л╤И╤М тАФ ╤В╤П╨╜╨╡╤В╤Б╤П ╨╜╨╡ ╤А╨░╨╝╨║╨░, ╨░ ╨▓╨╡╤Б╤М ╤Е╨╛╨╗╤Б╤В.
-    data: { name: g.name },
+    data: { name: g.name, color: g.color ?? "#2C3E50", isHighlighted: highlightedFrameId === g.arc_id, onRename: (next: string) => onRenameChapter(g.arc_id, next) },
   };
 }
-
+//
+//
 export function CanvasPage() {
   // ╨з╤В╨╛ ╨╛╤В╨║╤А╤Л╤В╨╛ тАФ ╨▓ ╨░╨┤╤А╨╡╤Б╨╡, ╨║╨░╨║ ╨╛╨║╤А╨╡╤Б╤В╨╜╨╛╤Б╤В╤М ╤Г ╨У╤А╨░╤Д╨░ ╤Б╨▓╤П╨╖╨╡╨╣: ╨╜╨░ ╤Е╨╛╨╗╤Б╤В ╨▓╨╡╨┤╤Г╤В
   // ╤Б╤Б╤Л╨╗╨║╨╕ ╤Б╨╛ ╤Б╤В╤А╨░╨╜╨╕╤Ж ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╣, ╨╕ ╤В╨░╨║╤Г╤О ╤Б╤Б╤Л╨╗╨║╤Г ╨╝╨╛╨╢╨╜╨╛ ╤Б╨╛╤Е╤А╨░╨╜╨╕╤В╤М.
   const [searchParams, setSearchParams] = useSearchParams();
   const settingId = Number(searchParams.get("setting")) || 0;
   const arcId = Number(searchParams.get("arc")) || 0;
-
+  const campaignIdParam = Number(searchParams.get("campaign")) || 0;
+  const freeId = Number(searchParams.get("free_id")) || 0;
+  const focusParam = searchParams.get("focus") || "";
+//
   // ╨Ъ╨░╨╗╨╡╨╜╨┤╨░╤А╤М ╨╜╤Г╨╢╨╡╨╜ ╤А╨░╨┤╨╕ ╨┤╨░╤В ╨╜╨░ ╨╜╨╛╨┤╨░╤Е ╤Б╨╛╨▒╤Л╤В╨╕╨╣: ╨╝╨╡╤Б╤П╤Ж╤Л ╨╕ ╤Н╤А╨░ ╨╢╨╕╨▓╤Г╤В ╨▓
   // ╤Б╨╡╤В╤В╨╕╨╜╨│╨╡, ╨╕ ╨▒╨╡╨╖ ╨╜╨╕╤Е ┬л1492-06-15┬╗ ╨╛╤Б╤В╨░╨╗╨╛╤Б╤М ╨▒╤Л ╨╝╨░╤И╨╕╨╜╨╜╨╛╨╣ ╤Б╤В╤А╨╛╨║╨╛╨╣.
   const calendar = useSettingCalendar(settingId);
   const calendarRef = useRef<{ months: CalendarMonth[]; era: string }>({ months: [], era: "" });
   calendarRef.current = { months: calendar?.months ?? [], era: calendar?.era ?? "" };
-
+//
   const [settings, setSettings] = useState<Setting[]>([]);
   const [arcs, setArcs] = useState<StoryArc[]>([]);
+  const [campaigns, setCampaigns] = useState<{ id: number; name: string }[]>([]);
   const [board, setBoard] = useState<CanvasBoard | null>(null);
   const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>([]);
+  const [freeBoards, setFreeBoards] = useState<{ id: number; name: string; nodes: number }[]>([]);
   const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
+  const [selectedCheckId, setSelectedCheckId] = useState<number | null>(null);
+  const [highlightedFrameId, setHighlightedFrameId] = useState<number | null>(null);
+  const [searchQuery, setSearchQuery] = useState("");
+  const [panelCollapsed, setPanelCollapsed] = useState(() => {
+    try { return localStorage.getItem("canvasPropsCollapsed") === "1"; } catch { return false; }
+  });
   // ╨Я╨░╨╗╨╕╤В╤А╨░ ╨╖╨░╨║╤А╤Л╤В╨░ ╨┐╨╛ ╤Г╨╝╨╛╨╗╤З╨░╨╜╨╕╤О: ╨╖╨░ ╤Б╤В╨╛╨╗╨╛╨╝ ╤Е╨╛╨╗╤Б╤В ╨╜╤Г╨╢╨╡╨╜ ╤Ж╨╡╨╗╨╕╨║╨╛╨╝, ╨░ ╨┐╨╛╨┐╨╛╨╗╨╜╤П╤О╤В
   // ╨╡╨│╨╛ ╨▓ ╨┐╨╛╨┤╨│╨╛╤В╨╛╨▓╨║╨╡.
   const [paletteOpen, setPaletteOpen] = useState(false);
@@ -475,43 +855,208 @@ export function CanvasPage() {
   // ╤Б╨▓╨╛╨╣╤Б╤В╨▓╨░╤Е ╨╝╨╡╨╜╤П╨╗╨░ ╨▒╨░╨╖╤Г, ╨░ ╨╛╤В╨║╤А╤Л╤В╨░╤П ╤А╤П╨┤╨╛╨╝ ╨┐╨░╨╗╨╕╤В╤А╨░ ╨┐╤А╨╛╨┤╨╛╨╗╨╢╨░╨╗╨░ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╤В╤М
   // ╤Б╤В╨░╤А╤Л╨╣ ╤Б╨┐╨╕╤Б╨╛╨║ тАФ ╨╕ ╨▓╤Л╨│╨╗╤П╨┤╨╡╨╗╨╛ ╤Н╤В╨╛ ╨║╨░╨║ ┬л╨│╨░╨╗╨╛╤З╨║╨░ ╨╜╨╡ ╤Б╤А╨░╨▒╨╛╤В╨░╨╗╨░┬╗.
   const [shelfVersion, setShelfVersion] = useState(0);
-
+  const flowRef = useRef<ReturnType<typeof useReactFlow> | null>(null);
+  // ╨Ш╤Б╤В╨╛╤А╨╕╤П ╤А╨░╤Б╨║╨╗╨░╨┤╨║╨╕ ╨┤╨╗╤П undo/redo: ╤Е╤А╨░╨╜╨╕╨╝ ╤В╨╛╨╗╤М╨║╨╛ x,y.
+  const historyRef = useRef<{ nodes: { id: string; x: number; y: number }[] }[]>([]);
+  const historyIndexRef = useRef(-1);
+  const [canUndo, setCanUndo] = useState(false);
+  const [canRedo, setCanRedo] = useState(false);
+//
+  function pushHistory(current: Node<CanvasNodeData>[]) {
+    const snap = current.filter((n) => !isFrame(n.id)).map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
+    // ╨╛╨▒╤А╨╡╨╖╨░╨╡╨╝ ╨▒╤Г╨┤╤Г╤Й╨╡╨╡ ╨┐╤А╨╕ ╨╜╨╛╨▓╨╛╨╣ ╨▓╨╡╤В╨║╨╡
+    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
+    historyRef.current.push({ nodes: snap });
+    if (historyRef.current.length > 40) historyRef.current.shift();
+    else historyIndexRef.current++;
+    if (historyRef.current.length > 40) historyIndexRef.current = 39;
+    setCanUndo(historyIndexRef.current >= 0);
+    setCanRedo(false);
+  }
+  function undoLayout() {
+    if (historyIndexRef.current < 0) return;
+    const snap = historyRef.current[historyIndexRef.current];
+    historyIndexRef.current--;
+    setNodes((cur) => {
+      const m = new Map(snap.nodes.map((n) => [n.id, n]));
+      const next = cur.map((n) => (m.has(n.id) ? { ...n, position: { x: m.get(n.id)!.x, y: m.get(n.id)!.y } } : n));
+      scheduleSave(next);
+      return next;
+    });
+    setCanUndo(historyIndexRef.current >= 0);
+    setCanRedo(true);
+  }
+  function redoLayout() {
+    if (historyIndexRef.current + 1 >= historyRef.current.length) return;
+    historyIndexRef.current++;
+    const snap = historyRef.current[historyIndexRef.current];
+    setNodes((cur) => {
+      const m = new Map(snap.nodes.map((n) => [n.id, n]));
+      const next = cur.map((n) => (m.has(n.id) ? { ...n, position: { x: m.get(n.id)!.x, y: m.get(n.id)!.y } } : n));
+      scheduleSave(next);
+      return next;
+    });
+    setCanUndo(true);
+    setCanRedo(historyIndexRef.current + 1 < historyRef.current.length);
+  }
+//
   useEffect(() => {
     api.get<Setting[]>("/settings").then(setSettings);
   }, []);
-
+//
   useEffect(() => {
     if (!settingId) {
       setArcs([]);
+      setCampaigns([]);
       return;
     }
     api.get<StoryArc[]>(`/story/arcs?setting_id=${settingId}`).then(setArcs);
+    api.get<{ id: number; name: string }[]>("/campaigns?setting_id=" + settingId).then(setCampaigns).catch(() => setCampaigns([]));
   }, [settingId]);
-
+//
+  useEffect(() => {
+    api.get<{ id: number; name: string; nodes: number }[]>("/canvas/free-boards").then(setFreeBoards).catch(() => {});
+  }, [shelfVersion]);
+//
   // ╨з╨╡╤А╨╡╨╖ ref, ╨░ ╨╜╨╡ ╤З╨╡╤А╨╡╨╖ ╨╖╨░╨▓╨╕╤Б╨╕╨╝╨╛╤Б╤В╤М: ╨╛╨▒╤А╨░╨▒╨╛╤В╤З╨╕╨║ ┬л╨▓╤Л╤В╨░╤Й╨╕╤В╤М ╤Б╨╛╤Б╤В╨░╨▓┬╗ ╨╖╨╜╨░╨╡╤В
   // ╨┐╨╛╨╖╨╕╤Ж╨╕╤О ╨╜╨╛╨┤╤Л, ╤В╨╛ ╨╡╤Б╤В╤М ╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╨╜╨░ ╨║╨░╨╢╨┤╨╛╨╡ ╨┐╨╡╤А╨╡╤В╨░╤Б╨║╨╕╨▓╨░╨╜╨╕╨╡, ╨╕ ╨┤╨╡╤А╨╢╨░╤В╤М ╨╡╨│╨╛ ╨▓
   // ╨╖╨░╨▓╨╕╤Б╨╕╨╝╨╛╤Б╤В╤П╤Е loadBoard ╨╖╨╜╨░╤З╨╕╨╗╨╛ ╨▒╤Л ╨┐╨╡╤А╨╡╨╖╨░╨│╤А╤Г╨╢╨░╤В╤М ╤Е╨╛╨╗╤Б╤В ╨┐╤А╨╕ ╨║╨░╨╢╨┤╨╛╨╝ ╤Б╨┤╨▓╨╕╨│╨╡.
   const pullCastRef = useRef<(sceneId: number) => void>(() => {});
-
+  const addCheckRef = useRef<(sceneId: number) => void>(() => {});
+  const drillDownRef = useRef<(arcId: number) => void>(() => {});
+  const renameFrameRef = useRef<(id: number, next: string) => void>(() => {});
+  const renameChapterRef = useRef<(arcId: number, next: string) => void>(() => {});
+//
   const loadBoard = useCallback(() => {
+    // ╨д╤А╨╕╤Д╨╛╤А╨╝
+    if (freeId) {
+      api.get<CanvasBoard>(`/canvas/board?free_id=${freeId}`).then((b) => {
+        setBoard(b);
+        setNodes([
+          ...(b.groups ?? []).map((g) => toFrameNode(g, highlightedFrameId, renameChapterRef.current)),
+          ...b.nodes.map((n) =>
+            toFlowNode(n, {
+              onPullCast: pullCastRef.current,
+              onAddCheck: addCheckRef.current,
+              onDrillDown: drillDownRef.current,
+              highlightedFrameId,
+              onRenameFrame: renameFrameRef.current,
+              onRenameChapter: renameChapterRef.current,
+              months: calendarRef.current.months,
+              era: calendarRef.current.era,
+            })
+          ),
+        ]);
+        // focus handling after render
+        if (focusParam) {
+          setTimeout(() => {
+            const inst = (flowRef as unknown as { current: { fitView?: (o: unknown) => void; setCenter?: (x: number, y: number, o: unknown) => void } | null }).current;
+            const target = b.nodes.find((n) => n.key === focusParam) ?? b.nodes.find((n) => `${n.node_type}:${n.node_id}` === focusParam);
+            if (target && inst?.fitView) {
+              // @ts-ignore
+              inst.fitView({ nodes: [{ id: target.key }], duration: 300, padding: 0.3 });
+            }
+          }, 80);
+        }
+      });
+      return;
+    }
+    // ╨б╨╡╤В╤В╨╕╨╜╨│-╨╛╨▒╨╖╨╛╤А
+    if (settingId && !arcId && !campaignIdParam) {
+      api.get<CanvasBoard>(`/canvas/board?setting_id=${settingId}`).then((b) => {
+        setBoard(b);
+        setNodes(
+          b.nodes.map((n) =>
+            toFlowNode(n, {
+              onPullCast: pullCastRef.current,
+              onAddCheck: addCheckRef.current,
+              onDrillDown: drillDownRef.current,
+              highlightedFrameId,
+              onRenameFrame: renameFrameRef.current,
+              onRenameChapter: renameChapterRef.current,
+              months: calendarRef.current.months,
+              era: calendarRef.current.era,
+            })
+          )
+        );
+      });
+      return;
+    }
+    // ╨б╨▒╨╛╤А╨║╨░ ╨║╨░╨╝╨┐╨░╨╜╨╕╨╕
+    if (campaignIdParam && !arcId) {
+      api.get<CanvasBoard>(`/canvas/board?campaign_id=${campaignIdParam}`).then((b) => {
+        setBoard(b);
+        setNodes(
+          b.nodes.map((n) =>
+            toFlowNode(n, {
+              onPullCast: pullCastRef.current,
+              onAddCheck: addCheckRef.current,
+              onDrillDown: drillDownRef.current,
+              highlightedFrameId,
+              onRenameFrame: renameFrameRef.current,
+              onRenameChapter: renameChapterRef.current,
+              months: calendarRef.current.months,
+              era: calendarRef.current.era,
+            })
+          )
+        );
+      });
+      return;
+    }
     if (!arcId) {
       setBoard(null);
       setNodes([]);
       return;
     }
-    api.get<CanvasBoard>(`/canvas/board?arc_id=${arcId}`).then((b) => {
+    const qs = campaignIdParam ? `?arc_id=${arcId}&campaign_id=${campaignIdParam}` : `?arc_id=${arcId}`;
+    api.get<CanvasBoard>(`/canvas/board${qs}`).then((b) => {
       setBoard(b);
       setNodes([
         // ╨а╨░╨╝╨║╨╕ ╨╕╨┤╤Г╤В ╨┐╨╡╤А╨▓╤Л╨╝╨╕ тАФ ╨┐╨╛╨┤ ╤Б╤Ж╨╡╨╜╨░╨╝╨╕: React Flow ╤А╨╕╤Б╤Г╨╡╤В ╨▓ ╨┐╨╛╤А╤П╨┤╨║╨╡
         // ╨╝╨░╤Б╤Б╨╕╨▓╨░, ╨╕ ╨╛╨┤╨╜╨╛╨│╨╛ zIndex ╨╝╨░╨╗╨╛, ╨║╨╛╨│╨┤╨░ ╨╜╨╛╨┤╤Л ╨┐╨╡╤А╨╡╤А╨╕╤Б╨╛╨▓╤Л╨▓╨░╤О╤В╤Б╤П.
-        ...(b.groups ?? []).map(toFrameNode),
+        ...(b.groups ?? []).map((g) => toFrameNode(g, highlightedFrameId, renameChapterRef.current)),
         ...b.nodes.map((n) =>
-          toFlowNode(n, pullCastRef.current, calendarRef.current.months, calendarRef.current.era)
+          toFlowNode(n, {
+            onPullCast: pullCastRef.current,
+            onAddCheck: addCheckRef.current,
+            onDrillDown: drillDownRef.current,
+            highlightedFrameId,
+            onRenameFrame: renameFrameRef.current,
+            onRenameChapter: renameChapterRef.current,
+            months: calendarRef.current.months,
+            era: calendarRef.current.era,
+          })
         ),
       ]);
+      // ╤Д╨╛╨║╤Г╤Б: ╨┐╨╛╨┤╤Б╨▓╨╡╤В╨║╨░ + ╤Д╨╕╤В
+      if (focusParam) {
+        const [type, raw] = focusParam.split(":");
+        const id = Number(raw);
+        if (type === "scene") setSelectedSceneId(id);
+        if (type === "check") setSelectedCheckId(id);
+        if (type === "frame" || type === "chapter") setHighlightedFrameId(Number(raw));
+        // ╨Э╨╡╨┐╨╛╨┤╨▓╨╕╨╜╤Г╤В╨░╤П ╨╜╨╛╨┤╨░ тАФ ╤Б╤А╨░╨╖╤Г ╤Б╨╛╤Е╤А╨░╨╜╨╕╤В╤М, ╨╕╨╜╨░╤З╨╡ ╤Д╨╛╨║╤Г╤Б ╨┐╨╛╤В╨╡╤А╤П╨╡╤В╤Б╤П ╨┐╨╛╤Б╨╗╨╡ ╨┐╨╡╤А╨╡╨╖╨░╨│╤А╤Г╨╖╨║╨╕.
+        setTimeout(() => {
+          const key = focusParam.includes(":") ? focusParam : null;
+          if (!key) return;
+          const found = b.nodes.find((n) => n.key === key);
+          if (found && !found.placed && b.board_id) {
+            api.put("/canvas/board/nodes", {
+              board_id: b.board_id,
+              nodes: [{ node_type: found.node_type, node_id: found.node_id, x: Math.round(found.x), y: Math.round(found.y) }],
+            });
+          }
+          // fitView ╨║ ╤Д╨╛╨║╤Г╤Б╤Г
+          const inst = (flowRef as unknown as { current: { fitView?: (o: unknown) => void } | null }).current;
+          if (found && inst?.fitView) {
+            // @ts-ignore
+            inst.fitView({ nodes: [{ id: found.key }], duration: 400, padding: 0.4 });
+          }
+        }, 80);
+      }
     });
-  }, [arcId]);
-
+  }, [arcId, settingId, campaignIdParam, freeId, focusParam, highlightedFrameId]);
+//
   useEffect(loadBoard, [loadBoard]);
   // ╨Ъ╨░╨╗╨╡╨╜╨┤╨░╤А╤М ╨┐╤А╨╕╨╡╨╖╨╢╨░╨╡╤В ╨╛╤В╨┤╨╡╨╗╤М╨╜╤Л╨╝ ╨╖╨░╨┐╤А╨╛╤Б╨╛╨╝ ╨╕ ╨┐╨╛╨╖╨╢╨╡ ╤Е╨╛╨╗╤Б╤В╨░: ╨▒╨╡╨╖ ╤Н╤В╨╛╨│╨╛ ╨┤╨░╤В╤Л ╨╜╨░
   // ╨╜╨╛╨┤╨░╤Е ╤Б╨╛╨▒╤Л╤В╨╕╨╣ ╨╛╤Б╤В╨░╨╗╨╕╤Б╤М ╨▒╤Л ╨┐╤Г╤Б╤В╤Л╨╝╨╕ ╨┤╨╛ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╡╨│╨╛ ╨┤╨╡╨╣╤Б╤В╨▓╨╕╤П.
@@ -519,13 +1064,13 @@ export function CanvasPage() {
     if (calendar) loadBoard();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [calendar]);
-
+//
   // ╨а╤С╨▒╤А╨░ ╨┤╨╡╤А╨╢╨╕╨╝ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡╨╝, ╨░ ╨╜╨╡ ╨▓╤Л╨▓╨╛╨┤╨╕╨╝ ╨╕╨╖ board ╨╜╨░ ╨╗╨╡╤В╤Г: React Flow тАФ ╤Н╤В╨╛
   // ╤Г╨┐╤А╨░╨▓╨╗╤П╨╡╨╝╤Л╨╣ ╨║╨╛╨╝╨┐╨╛╨╜╨╡╨╜╤В, ╨╕ ╨▒╨╡╨╖ onEdgesChange ╨╛╨╜ ╨╜╨╡ ╤Б╤З╨╕╤В╨░╨╡╤В ╨╜╨░╨▒╨╛╤А ╤А╤С╨▒╨╡╤А
   // ╨╢╨╕╨▓╤Л╨╝ (╨▓╤Л╨┤╨╡╨╗╨╡╨╜╨╕╨╡ ╨╕ ╤Г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ╨┤╨╛ ╨╜╨╡╨│╨╛ ╨╜╨╡ ╨┤╨╛╤Е╨╛╨┤╤П╤В, ╨░ ╨▓╨╝╨╡╤Б╤В╨╡ ╤Б ╨╜╨╕╨╝╨╕ ╨╕ ╤Б╨░╨╝╨░
   // ╨╛╤В╤А╨╕╤Б╨╛╨▓╨║╨░).
   const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
-
+//
   useEffect(() => {
     setEdges(
       (board?.edges ?? []).map((e) => ({
@@ -543,18 +1088,19 @@ export function CanvasPage() {
       }))
     );
   }, [board, setEdges]);
-
+//
   // ╨а╨░╤Б╨║╨╗╨░╨┤╨║╨░ ╤Б╨╛╤Е╤А╨░╨╜╤П╨╡╤В╤Б╤П ╨┐╨░╤З╨║╨╛╨╣ ╨╕ ╤Б ╨╖╨░╨┤╨╡╤А╨╢╨║╨╛╨╣: ╨┐╨╡╤А╨╡╤В╨░╤Б╨║╨╕╨▓╨░╨╜╨╕╨╡ ╤А╨╛╨╢╨┤╨░╨╡╤В
   // ╤Б╨╛╨▒╤Л╤В╨╕╨╡ ╨╜╨░ ╨║╨░╨╢╨┤╤Л╨╣ ╨║╨░╨┤╤А, ╨╕ ╨╖╨░╨┐╤А╨╛╤Б ╨╜╨░ ╨║╨░╨┤╤А ╨┐╤А╨╡╨▓╤А╨░╤В╨╕╨╗ ╨▒╤Л ╨╛╨┤╨╕╨╜ ╨╢╨╡╤Б╤В ╨▓ ╤Б╨╛╤В╨╜╤О
   // ╨╖╨░╨┐╨╕╤Б╨╡╨╣ ╨▓ ╨▒╨░╨╖╤Г.
   const saveTimer = useRef<number | null>(null);
   const scheduleSave = useCallback(
     (next: Node<CanvasNodeData>[]) => {
-      if (!arcId) return;
+      const boardId = board?.board_id;
+      if (!boardId) return;
       if (saveTimer.current) window.clearTimeout(saveTimer.current);
       saveTimer.current = window.setTimeout(() => {
         api.put("/canvas/board/nodes", {
-          arc_id: arcId,
+          board_id: boardId,
           nodes: next.filter((n) => !isFrame(n.id)).map((n) => {
             const [nodeType, nodeId] = splitKey(n.id);
             return {
@@ -562,41 +1108,47 @@ export function CanvasPage() {
               node_id: nodeId,
               x: Math.round(n.position.x),
               y: Math.round(n.position.y),
+              z_index: Math.round((n as unknown as { zIndex?: number }).zIndex ?? 0),
             };
           }),
         });
+        // ╤Д╤А╨╡╨╣╨╝╤Л ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛: ╨╛╨╜╨╕ ╨▓ canvas_frames / canvas_groups
+        next.filter((n) => n.id.startsWith("frame:")).forEach((n) => {
+          const fid = Number(splitKey(n.id)[1]);
+          api.put(`/canvas/frames/${fid}`, { x: Math.round(n.position.x), y: Math.round(n.position.y) }).catch(() => {});
+        });
       }, 500);
     },
-    [arcId]
+    [board]
   );
-
+//
   useEffect(() => {
     return () => {
       if (saveTimer.current) window.clearTimeout(saveTimer.current);
     };
   }, []);
-
+//
   // ╨Я╨╡╤А╨╡╤А╨╕╤Б╨╛╨▓╨░╤В╤М ╨▓╤Б╤С, ╤З╤В╨╛ ╨╝╨╛╨│╨╗╨╛ ╨╕╨╖╨╝╨╡╨╜╨╕╤В╤М╤Б╤П ╨╛╤В ╨┐╤А╨░╨▓╨║╨╕ ╨▓ ╨┐╨░╨╜╨╡╨╗╨╕ ╤Б╨▓╨╛╨╣╤Б╤В╨▓: ╨╕
   // ╤Е╨╛╨╗╤Б╤В, ╨╕ ╨┐╨╛╨╗╨║╤Г.
   const refreshAll = useCallback(() => {
     loadBoard();
     setShelfVersion((v) => v + 1);
   }, [loadBoard]);
-
+//
   // ╨Ъ╨╛╨│╨╛ ╤А╨░╨╝╨║╨░ ╤В╨░╤Й╨╕╤В ╨╖╨░ ╤Б╨╛╨▒╨╛╨╣. ╨б╨╛╤Б╤В╨░╨▓ ╤Б╤З╨╕╤В╨░╨╡╤В╤Б╤П ╨Ю╨Ф╨Ш╨Э ╤А╨░╨╖, ╨▓ ╨╝╨╛╨╝╨╡╨╜╤В ╨╖╨░╤Е╨▓╨░╤В╨░:
   // ╨┐╨╡╤А╨╡╤Б╤З╨╕╤В╤Л╨▓╨░╤В╤М ╨╡╨│╨╛ ╨╜╨░ ╨║╨░╨╢╨┤╨╛╨╝ ╨║╨░╨┤╤А╨╡ ╨╖╨╜╨░╤З╨╕╤В ╤В╨╡╤А╤П╤В╤М ╨┐╨╛ ╨┤╨╛╤А╨╛╨│╨╡ ╤Б╤Ж╨╡╨╜╤Г, ╨║╨╛╤В╨╛╤А╨░╤П
   // ╨╜╨░ ╨┐╨╛╨╗╨┐╤Г╤В╨╕ ╨▓╤Л╤И╨╗╨░ ╨╖╨░ ╨║╤А╨░╨╣ ╤А╨░╨╝╨║╨╕, тАФ ╨╕ ╨┐╨╛╨╗╨╛╨▓╨╕╨╜╨░ ╨│╨╗╨░╨▓╤Л ╨╛╤Б╤В╨░╨╗╨░╤Б╤М ╨▒╤Л ╨┐╨╛╨╖╨░╨┤╨╕.
   const nodesRef = useRef<Node<CanvasNodeData>[]>([]);
   nodesRef.current = nodes;
   const frameDragRef = useRef<{ id: string; children: Set<string> } | null>(null);
-
+//
   const onNodeDragStart = useCallback((_: unknown, node: Node<CanvasNodeData>) => {
     if (!isFrame(node.id)) {
       frameDragRef.current = null;
       return;
     }
-    const w = Number(node.width ?? node.style?.width ?? 0);
-    const h = Number(node.height ?? node.style?.height ?? 0);
+    const w = Number(node.width ?? (node as unknown as { style?: { width?: number } }).style?.width ?? 0);
+    const h = Number(node.height ?? (node as unknown as { style?: { height?: number } }).style?.height ?? 0);
     const { x, y } = node.position;
     frameDragRef.current = {
       id: node.id,
@@ -613,22 +1165,31 @@ export function CanvasPage() {
           .map((n) => n.id)
       ),
     };
+    pushHistory(nodesRef.current);
   }, []);
-
+//
   const onNodeDragStop = useCallback(
     (_: unknown, node: Node<CanvasNodeData>) => {
       if (isFrame(node.id) && board) {
-        api.put(`/canvas/groups/${splitKey(node.id)[1]}`, {
-          board_id: board.board_id,
-          x: Math.round(node.position.x),
-          y: Math.round(node.position.y),
-        });
+        const kind = node.id.split(":")[0];
+        if (kind === "chapter") {
+          api.put(`/canvas/groups/${splitKey(node.id)[1]}`, {
+            board_id: board.board_id,
+            x: Math.round(node.position.x),
+            y: Math.round(node.position.y),
+          });
+        } else {
+          api.put(`/canvas/frames/${splitKey(node.id)[1]}`, {
+            x: Math.round(node.position.x),
+            y: Math.round(node.position.y),
+          });
+        }
       }
       frameDragRef.current = null;
     },
     [board]
   );
-
+//
   const onNodesChange = useCallback(
     (changes: NodeChange<Node<CanvasNodeData>>[]) => {
       setNodes((current) => {
@@ -658,7 +1219,7 @@ export function CanvasPage() {
     },
     [scheduleSave]
   );
-
+//
   // ╨з╤В╨╛ ╨╛╨╖╨╜╨░╤З╨░╨╡╤В ╨┐╤А╨╛╤В╤П╨╜╤Г╤В╨░╤П ╤Б╤В╤А╨╡╨╗╨║╨░, ╤А╨╡╤И╨░╨╡╤В ╨а╨Р╨Ч╨к╨Б╨Ь, ╨▓ ╨║╨╛╤В╨╛╤А╤Л╨╣ ╨╡╤С ╨▓╨╛╤В╨║╨╜╤Г╨╗╨╕, ╨░
   // ╨╜╨╡ ╤В╨╕╨┐ ╤В╨╛╨│╨╛, ╤З╤В╨╛ ╤В╤П╨╜╤Г╨╗╨╕. ╨б╤Г╤Й╨╡╤Б╤В╨▓╨╛ ╨▒╤Л╨▓╨░╨╡╤В ╨╕ ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╛╨╝, ╨╕ ╨╛╨▒╤Б╤В╨░╨╜╨╛╨▓╨║╨╛╨╣; ╨▓
   // ┬л╨╝╨╡╤Б╤В╨╛┬╗ ╨╡╨│╨╛ ╤В╨╛╨╢╨╡ ╨╝╨╛╨╢╨╜╨╛ ╨▓╨╛╤В╨║╨╜╤Г╤В╤М, ╨╕ ╤Н╤В╨╛ ╨╛╤Б╨╝╤Л╤Б╨╗╨╡╨╜╨╜╨╛.
@@ -668,7 +1229,15 @@ export function CanvasPage() {
       const [sourceType, sourceId] = splitKey(connection.source);
       const [targetType, targetId] = splitKey(connection.target);
       const handle = connection.targetHandle ?? "story";
-
+//
+      // ╨Р╤Г╨┤╨╕╨╛/╨▒╨╛╨╣ тАФ ╤Б╤В╤А╨╛╨│╨░╤П ╤В╨╕╨┐╨╕╨╖╨░╤Ж╨╕╤П: sound_set ╤В╨╛╨╗╤М╨║╨╛ ╨▓ audio, playlist ╤В╨╛╨╗╤М╨║╨╛ ╨▓ battle.
+      if (handle === "audio" && sourceType !== "sound_set") return;
+      if (handle === "battle" && sourceType !== "playlist") return;
+      if ((sourceType === "sound_set" || sourceType === "playlist") && handle !== "audio" && handle !== "battle") {
+        // ╨╖╨▓╤Г╨║ ╨╜╨╡ ╨▓╤В╤Л╨║╨░╤О╤В ╨▓ ╨╛╨▒╤Л╤З╨╜╤Л╨╡ ╤А╨░╨╖╤К╤С╨╝╤Л
+        return;
+      }
+//
       // ╨Я╨╛╤Б╨╗╨╡╨┤╤Б╤В╨▓╨╕╨╡ ╤В╤П╨╜╤Г╤В ╨Ю╨в ╤Б╤Ж╨╡╨╜╤Л ╨Ъ ╤Б╨╛╨▒╤Л╤В╨╕╤О тАФ ╨╡╨┤╨╕╨╜╤Б╤В╨▓╨╡╨╜╨╜╨░╤П ╤Б╨▓╤П╨╖╤М ╤Б╤Ж╨╡╨╜╤Л ╤Б
       // ╤В╨░╨║╨╕╨╝ ╨╜╨░╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╨╡╨╝.
       if (sourceType === "scene" && (targetType === "setting_event" || targetType === "campaign_event")) {
@@ -677,15 +1246,38 @@ export function CanvasPage() {
           to_id: targetId,
           role: "consequences",
         });
+      } else if (handle === "audio" || handle === "battle") {
+        const role = handle === "audio" ? "audio" : "battle";
+        await api.post(`/story/scenes/${targetId}/cast`, {
+          to_type: sourceType,
+          to_id: sourceId,
+          role,
+        });
       } else if (targetType === "bundle") {
         await api.post(`/canvas/bundles/${targetId}/members`, {
           to_type: sourceType,
           to_id: sourceId,
         });
       } else if (handle === "story") {
-        if (sourceType !== "scene" || targetType !== "scene") return;
-        await api.post(`/story/scenes/${sourceId}/transitions`, { to_scene_id: targetId });
+        // ╨Я╨╡╤А╨╡╤Е╨╛╨┤ ╨╝╨╡╨╢╨┤╤Г ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П╨╝╨╕ ╨╕╨╗╨╕ ╤Б╤Ж╨╡╨╜╨░╨╝╨╕
+        if (sourceType === "adventure" && targetType === "adventure") {
+          await api.post(`/story/arcs/${sourceId}/transitions`, { to_arc_id: targetId });
+        } else {
+          if (sourceType !== "scene" || targetType !== "scene") return;
+          await api.post(`/story/scenes/${sourceId}/transitions`, { to_scene_id: targetId });
+        }
+      } else if (handle.startsWith("outcome:")) {
+        const outcomeId = Number(handle.split(":")[1]);
+        await api.put(`/story/outcomes/${outcomeId}`, { target_type: targetType, target_id: targetId });
       } else {
+        // ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ тЖТ ╤Б╤Ж╨╡╨╜╨░
+        if (sourceType === "check") {
+          const outcomeId = Number(handle.split(":")[1] ?? sourceId);
+          // ╨╡╤Б╨╗╨╕ ╤В╤П╨╜╤Г╤В ╨╕╨╖ ╨┐╤А╨╛╨▓╨╡╤А╨║╨╕ ╨▒╨╡╨╖ ╤Г╨║╨░╨╖╨░╨╜╨╕╤П ╨╕╤Б╤Е╨╛╨┤╨░ тАФ ╨▒╨╡╤А╤С╨╝ ╨┐╨╡╤А╨▓╤Л╨╣
+          await api.put(`/story/outcomes/${outcomeId}`, { target_type: "scene", target_id: targetId });
+          loadBoard();
+          return;
+        }
         await api.post(`/story/scenes/${targetId}/cast`, {
           to_type: sourceType,
           to_id: sourceId,
@@ -696,7 +1288,7 @@ export function CanvasPage() {
     },
     [loadBoard]
   );
-
+//
   // ╨г╨┤╨░╨╗╨╡╨╜╨╕╨╡ ╤А╨╡╨▒╤А╨░ ╨╖╨╜╨░╤З╨╕╤В ╤А╨░╨╖╨╜╨╛╨╡ ╨┤╨╗╤П ╨┤╨▓╤Г╤Е ╨▓╨╕╨┤╨╛╨▓. ╨Я╨╡╤А╨╡╤Е╨╛╨┤ ╨╕╤Б╤З╨╡╨╖╨░╨╡╤В ╤Б╨╛╨▓╤Б╨╡╨╝.
   // ╨Р ╤Г ╨╕╤Б╤Е╨╛╨┤╨░ ╨┐╤А╨╛╨▓╨╡╤А╨║╨╕ ╤Б╨╜╨╕╨╝╨░╨╡╤В╤Б╤П ╤В╨╛╨╗╤М╨║╨╛ ╤Б╨▓╤П╨╖╤М: ╤Б╨░╨╝ ╤А╨░╨╖╤К╤С╨╝ ╨╛╤Б╤В╨░╤С╤В╤Б╤П ╨╜╨░ ╨╝╨╡╤Б╤В╨╡
   // ╨▓╨╝╨╡╤Б╤В╨╡ ╤Б╨╛ ╤Б╨▓╨╛╨╡╨╣ ╨┐╨╛╨┤╨┐╨╕╤Б╤М╤О ╨╕ ╤В╨╡╨║╤Б╤В╨╛╨╝ ╨┐╨╛╤Б╨╗╨╡╨┤╤Б╤В╨▓╨╕╤П тАФ ┬л╨┐╤А╨╛╨▓╨░╨╗ ╨▒╨╛╨╗╤М╤И╨╡ ╨╜╨╡ ╨▓╨╡╨┤╤С╤В
@@ -709,11 +1301,15 @@ export function CanvasPage() {
           if (kind === "outcome") {
             return api.put(`/story/outcomes/${rawId}`, { target_type: null, target_id: null });
           }
+          if (kind === "arc_transition") {
+            return api.del(`/story/arc-transitions/${rawId}`);
+          }
           // ╨б╨╛╤Б╤В╨░╨▓ ╨╕ ╤З╨╗╨╡╨╜╤Б╤В╨▓╨╛ ╨▓ ╨╜╨░╨▒╨╛╤А╨╡ тАФ ╨╛╨▒╤Л╤З╨╜╤Л╨╡ ╤Б╨▓╤П╨╖╨╕; ╤Б╨╜╨╕╨╝╨░╨╡╤В╤Б╤П ╤Б╨▓╤П╨╖╤М, ╨░
           // ╨╜╨╛╨┤╨░ ╨╛╤Б╤В╨░╤С╤В╤Б╤П ╨╜╨░ ╤Е╨╛╨╗╤Б╤В╨╡. ╨Ю╨▒╤А╨░╤В╨╜╨╛╨╡ (┬л╤Г╨▒╤А╨░╨╗ ╨║╨▓╨░╨┤╤А╨░╤В╨╕╨║ тАФ ╨▓╤Л╨┐╨░╨╗ ╨╕╨╖
           // ╤Б╤Ж╨╡╨╜╤Л┬╗) ╨╝╨╛╨╗╤З╨░ ╨┐╨╛╤В╤А╨╛╤И╨╕╨╗╨╛ ╨▒╤Л ╤Б╤Ж╨╡╨╜╤Л ╨┐╤А╨╕ ╤А╨░╤Б╤З╨╕╤Б╤В╨║╨╡ ╤Б╤Е╨╡╨╝╤Л.
           if (kind === "cast") return api.del(`/story/cast/${rawId}`);
           if (kind === "member") return api.del(`/links/${rawId}`);
+          if (kind === "check") return api.del(`/story/checks/${rawId}`);
           return api.del(`/story/transitions/${rawId}`);
         })
       );
@@ -721,27 +1317,63 @@ export function CanvasPage() {
     },
     [loadBoard]
   );
-
+//
   // ╨Я╨╛╨╖╨╕╤Ж╨╕╤П ╨╜╨╛╨┤╤Л ╨▒╨╡╤А╤С╤В╤Б╤П ╨╕╨╖ ╤В╨╡╨║╤Г╤Й╨╡╨│╨╛ ╤Б╨╛╤Б╤В╨╛╤П╨╜╨╕╤П ╤Е╨╛╨╗╤Б╤В╨░, ╨░ ╨╜╨╡ ╨╕╨╖ ╨▒╨░╨╖╤Л: ╤Г
   // ╨╜╨╡╨┐╨╛╨┤╨▓╨╕╨╜╤Г╤В╨╛╨╣ ╨╜╨╛╨┤╤Л ╤Б╤В╤А╨╛╨║╨╕ ╨▓ ╨▒╨░╨╖╨╡ ╨╜╨╡╤В, ╨░ ╤Б╨╛╤Б╤В╨░╨▓ ╨┤╨╛╨╗╨╢╨╡╨╜ ╨╗╨╡╤З╤М ╤А╤П╨┤╨╛╨╝ ╤Б ╤В╨╡╨╝
   // ╨║╨▓╨░╨┤╤А╨░╤В╨╕╨║╨╛╨╝, ╨╜╨░ ╨║╨╛╤В╨╛╤А╤Л╨╣ ╨Ь╨░╤Б╤В╨╡╤А ╤В╨╛╨╗╤М╨║╨╛ ╤З╤В╨╛ ╨╜╨░╨╢╨░╨╗.
   const pullCast = useCallback(
     async (sceneId: number) => {
       const node = nodes.find((n) => n.id === `scene:${sceneId}`);
+      const boardId = board?.board_id;
+      if (!boardId) return;
       await api.post("/canvas/board/pull-cast", {
-        arc_id: arcId,
+        arc_id: arcId || undefined,
+        board_id: boardId,
         scene_id: sceneId,
         x: Math.round(node?.position.x ?? 0),
         y: Math.round(node?.position.y ?? 0),
       });
       loadBoard();
     },
-    [arcId, nodes, loadBoard]
+    [arcId, nodes, loadBoard, board]
   );
   useEffect(() => {
     pullCastRef.current = pullCast;
   }, [pullCast]);
-
+//
+  const addCheck = useCallback(
+    async (sceneId: number) => {
+      const sceneNode = nodes.find((n) => n.id === `scene:${sceneId}`);
+      const baseX = Math.round((sceneNode?.position.x ?? 0) + 240);
+      const baseY = Math.round((sceneNode?.position.y ?? 0));
+      const created = await api.post<{ id: number }>("/story/scenes/" + sceneId + "/checks", { what: "╨Э╨╛╨▓╨░╤П ╨┐╤А╨╛╨▓╨╡╤А╨║╨░", difficulty: "" });
+      // ╤Б╤А╨░╨╖╤Г ╨║╨╗╨░╨┤╤С╨╝ ╨┐╤А╨╛╨▓╨╡╤А╨║╤Г ╨╜╨░ ╤Е╨╛╨╗╤Б╤В ╤Б╨┐╤А╨░╨▓╨░
+      if (board?.board_id) {
+        await api.post("/canvas/board/node", { board_id: board.board_id, node_type: "check", node_id: created.id, x: baseX, y: baseY });
+      }
+      loadBoard();
+    },
+    [nodes, board, loadBoard]
+  );
+  useEffect(() => { addCheckRef.current = addCheck; }, [addCheck]);
+//
+  const drillDown = useCallback((arcIdToOpen: number) => {
+    setSearchParams({ setting: String(settingId), arc: String(arcIdToOpen) });
+  }, [settingId, setSearchParams]);
+  useEffect(() => { drillDownRef.current = drillDown; }, [drillDown]);
+//
+  const renameFrame = useCallback(async (id: number, next: string) => {
+    await api.put(`/canvas/frames/${id}`, { name: next });
+    loadBoard();
+  }, [loadBoard]);
+  useEffect(() => { renameFrameRef.current = renameFrame; }, [renameFrame]);
+  const renameChapter = useCallback(async (arcIdToRename: number, next: string) => {
+    if (!board) return;
+    await api.put(`/canvas/groups/${arcIdToRename}`, { board_id: board.board_id, name: next });
+    loadBoard();
+  }, [board, loadBoard]);
+  useEffect(() => { renameChapterRef.current = renameChapter; }, [renameChapter]);
+//
   // ╨г╨▒╤А╨░╤В╤М ╨╜╨╛╨┤╤Г ╤Б╤Г╤Й╨╜╨╛╤Б╤В╨╕ ╨╕╨╗╨╕ ╨╜╨░╨▒╨╛╤А╨░ тАФ ╨╖╨╜╨░╤З╨╕╤В ╤Г╨▒╤А╨░╤В╤М ╨╡╤С ╨б ╨е╨Ю╨Ы╨б╨в╨Р. ╨б╨▓╤П╨╖╨╕
   // ┬л╤Г╤З╨░╤Б╤В╨╜╨╕╨║ ╤Б╤Ж╨╡╨╜╤Л┬╗ ╨╛╤Б╤В╨░╤О╤В╤Б╤П: ╨╕╤Е ╨┐╤А╨░╨▓╤П╤В ╨╕ ╨╜╨░ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨╡ ╤Б╤Ж╨╡╨╜╤Л, ╨╕ ╤А╨░╤Б╤З╨╕╤Б╤В╨║╨░
   // ╤Б╤Е╨╡╨╝╤Л ╨╜╨╡ ╨┤╨╛╨╗╨╢╨╜╨░ ╨╝╨╛╨╗╤З╨░ ╨▓╤Л╨┐╨╛╤В╤А╨╛╤И╨╕╤В╤М ╤Б╤Ж╨╡╨╜╤Л. ╨Э╨╛╨┤╤Г ╤Б╤Ж╨╡╨╜╤Л ╤Г╨┤╨░╨╗╨╕╤В╤М ╨╜╨╡╨╗╤М╨╖╤П
@@ -749,21 +1381,24 @@ export function CanvasPage() {
   // ╨░╤А╤Е╨╕╨▓╨╕╤А╨╛╨▓╨░╤В╤М ╤Б╤Ж╨╡╨╜╤Г, ╤З╨╡╨│╨╛ ╨Ь╨░╤Б╤В╨╡╤А, ╨┤╨▓╨╕╨│╨░╤П ╨║╨▓╨░╨┤╤А╨░╤В╨╕╨║╨╕, ╨╜╨╡ ╨╕╨╝╨╡╨╗ ╨▓ ╨▓╨╕╨┤╤Г.
   const onNodesDelete = useCallback(
     async (removed: Node<CanvasNodeData>[]) => {
+      const boardId = board?.board_id;
+      if (!boardId) return;
       const removable = removed.filter((n) => !n.id.startsWith("scene:"));
       await Promise.all(
         removable.map((n) => {
           const [nodeType, nodeId] = splitKey(n.id);
           if (nodeType === "bundle") return api.del(`/canvas/bundles/${nodeId}`);
+          if (nodeType === "check") return api.del(`/story/checks/${nodeId}`);
           return api.del(
-            `/canvas/board/node?arc_id=${arcId}&node_type=${nodeType}&node_id=${nodeId}`
+            `/canvas/board/node?board_id=${boardId}&node_type=${nodeType}&node_id=${nodeId}`
           );
         })
       );
       loadBoard();
     },
-    [arcId, loadBoard]
+    [board, loadBoard]
   );
-
+//
   function pickSetting(value: number) {
     // ╨Я╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ ╨┐╤А╨╕╨╜╨░╨┤╨╗╨╡╨╢╨╕╤В ╤Б╨╡╤В╤В╨╕╨╜╨│╤Г, ╤В╨░╨║ ╤З╤В╨╛ ╤Б╨╝╨╡╨╜╨░ ╤Б╨╡╤В╤В╨╕╨╜╨│╨░ ╨╛╨▒╨╜╤Г╨╗╤П╨╡╤В ╨▓╤Л╨▒╨╛╤А.
     setSearchParams(value ? { setting: String(value) } : {});
@@ -771,13 +1406,79 @@ export function CanvasPage() {
   function pickArc(value: number) {
     const next: Record<string, string> = { setting: String(settingId) };
     if (value) next.arc = String(value);
+    if (campaignIdParam) next.campaign = String(campaignIdParam);
     setSearchParams(next);
   }
-
+  function pickCampaign(value: number) {
+    const next: Record<string, string> = { setting: String(settingId) };
+    if (arcId) next.arc = String(arcId);
+    if (value) next.campaign = String(value);
+    setSearchParams(next);
+  }
+  function pickFree(value: number) {
+    if (value) setSearchParams({ free_id: String(value) });
+    else setSearchParams(settingId ? { setting: String(settingId) } : {});
+  }
+//
+  // Breadcrumb тАФ ╤Е╨╗╨╡╨▒╨╜╤Л╨╡ ╨║╤А╨╛╤И╨║╨╕: ╨б╨╡╤В╤В╨╕╨╜╨│ тЖТ ╨Я╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ тЖТ ╨б╤Ж╨╡╨╜╨░ (focus)
+  const breadcrumbItems = (() => {
+    const items: { label: string; to?: string }[] = [];
+    const s = settings.find((x) => x.id === settingId);
+    if (s) items.push({ label: s.name, to: `/canvas?setting=${settingId}` });
+    const a = arcs.find((x) => x.id === arcId);
+    if (a) items.push({ label: a.name, to: `/canvas?setting=${settingId}&arc=${arcId}` });
+    else if (freeId) {
+      const f = freeBoards.find((x) => x.id === freeId);
+      if (f) items.push({ label: f.name });
+    } else if (board?.setting) {
+      items.push({ label: board.setting.name });
+    } else if (board?.campaign) {
+      items.push({ label: board.campaign.name });
+    } else if (board?.free) {
+      items.push({ label: board.free.name });
+    }
+    if (focusParam) {
+      const [t, id] = focusParam.split(":");
+      if (t === "scene" && selectedSceneId) {
+        const n = nodes.find((x) => x.id === `scene:${selectedSceneId}`);
+        // @ts-ignore
+        const name = (n?.data as unknown as { name?: string })?.name ?? `╨б╤Ж╨╡╨╜╨░ ${id}`;
+        items.push({ label: name });
+      } else if (t === "check") items.push({ label: `╨Я╤А╨╛╨▓╨╡╤А╨║╨░ ${id}` });
+      else if (t === "adventure") items.push({ label: `╨Я╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ ${id}` });
+      else items.push({ label: focusParam });
+    }
+    return items;
+  })();
+//
+  const filteredForSearch = (() => {
+    const q = searchQuery.trim().toLowerCase();
+    if (!q) return [];
+    return nodes
+      .filter((n) => {
+        const d = n.data as unknown as Record<string, unknown>;
+        const hay = [String((d.name as string) ?? ""), String((d.title as string) ?? ""), String((d.what as string) ?? ""), String((d.text as string) ?? "")].join(" ").toLowerCase();
+        return hay.includes(q);
+      })
+      .slice(0, 12);
+  })();
+//
   return (
     <div className="stack canvas-page">
       <SectionHeading section="canvas">╨Я╨╛╨╗╨╛╤В╨╜╨╛</SectionHeading>
-
+//
+      {breadcrumbItems.length > 0 && (
+        <div className="row" style={{ gap: 6, alignItems: "center", fontSize: "var(--fs-meta)" }}>
+          <Link to="/canvas" className="muted">╨Я╨╛╨╗╨╛╤В╨╜╨╛</Link>
+          {breadcrumbItems.map((it, i) => (
+            <span key={i} className="row" style={{ gap: 6, alignItems: "center" }}>
+              <span className="muted">/</span>
+              {it.to ? <Link to={it.to}>{it.label}</Link> : <span>{it.label}</span>}
+            </span>
+          ))}
+        </div>
+      )}
+//
       <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
         <select value={settingId || ""} onChange={(e) => pickSetting(Number(e.target.value))}>
           <option value="">тАФ ╤Б╨╡╤В╤В╨╕╨╜╨│ тАФ</option>
@@ -787,8 +1488,8 @@ export function CanvasPage() {
             </option>
           ))}
         </select>
-
-        <select value={arcId || ""} onChange={(e) => pickArc(Number(e.target.value))} disabled={!settingId}>
+//
+        <select value={arcId || ""} onChange={(e) => pickArc(Number(e.target.value))} disabled={!settingId && !freeId}>
           <option value="">тАФ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ тАФ</option>
           {arcs.map((a) => (
             <option key={a.id} value={a.id}>
@@ -796,25 +1497,60 @@ export function CanvasPage() {
             </option>
           ))}
         </select>
-
-        {arcId > 0 && (
+//
+        <select value={campaignIdParam || ""} onChange={(e) => pickCampaign(Number(e.target.value))} disabled={!settingId}>
+          <option value="">тАФ ╨║╨░╨╝╨┐╨░╨╜╨╕╤П тАФ</option>
+          {campaigns.map((c) => (
+            <option key={c.id} value={c.id}>
+              {c.name}
+            </option>
+          ))}
+        </select>
+//
+        <select value={freeId || ""} onChange={(e) => pickFree(Number(e.target.value))}>
+          <option value="">тАФ ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╨╡ ╨┤╨╛╤Б╨║╨╕ тАФ</option>
+          {freeBoards.map((b) => (
+            <option key={b.id} value={b.id}>
+              {b.name} ({b.nodes})
+            </option>
+          ))}
+        </select>
+//
+        {(arcId > 0 || freeId > 0 || (settingId && !arcId)) && (
           <button onClick={() => setPaletteOpen((v) => !v)}>
             {paletteOpen ? "╨б╨║╤А╤Л╤В╤М ╨┐╨░╨╗╨╕╤В╤А╤Г" : "╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М"}
           </button>
         )}
-
+//
         {board && (
           <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
-            {board.nodes.length} ╤Б╤Ж╨╡╨╜ ┬╖ {board.edges.length} ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨╛╨▓
+            {board.nodes.length} ╨╜╨╛╨┤ ┬╖ {board.edges.length} ╤Б╨▓╤П╨╖╨╡╨╣
             {board.groups.length > 0 && ` ┬╖ ${board.groups.length} ╨│╨╗╨░╨▓`}
           </span>
         )}
+//
+        <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
+          <button onClick={undoLayout} disabled={!canUndo} title="╨Ю╤В╨╝╨╡╨╜╨╕╤В╤М ╤А╨░╤Б╨║╨╗╨░╨┤╨║╤Г (Ctrl+Z)" style={{ width: 24, height: 24, border: "1.5px solid var(--line)" }}>тЖР</button>
+          <button onClick={redoLayout} disabled={!canRedo} title="╨Я╨╛╨▓╤В╨╛╤А╨╕╤В╤М (Ctrl+Y)" style={{ width: 24, height: 24, border: "1.5px solid var(--line)" }}>тЖТ</button>
+          <button
+            onClick={() => setPanelCollapsed((v) => { const nv = !v; try { localStorage.setItem("canvasPropsCollapsed", nv ? "1" : "0"); } catch {} return nv; })}
+            title={panelCollapsed ? "╨Я╨╛╨║╨░╨╖╨░╤В╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓╨░" : "╨б╨║╤А╤Л╤В╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓╨░"}
+            style={{ width: 24, height: 24, border: "1.5px solid var(--line)" }}
+          >
+            {panelCollapsed ? "┬╗" : "┬л"}
+          </button>
+        </div>
       </div>
-
-      {!arcId ? (
+//
+      {!arcId && !freeId && !settingId ? (
         <EmptyState
           title="╨Ш╤Б╤В╨╛╤А╨╕╤О ╨▓╨╕╨┤╨╜╨╛ ╤В╨╛╨╗╤М╨║╨╛ ╤Ж╨╡╨╗╨╕╨║╨╛╨╝"
-          hint="╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ тАФ ╨╡╨│╨╛ ╤Б╤Ж╨╡╨╜╤Л ╨╗╤П╨│╤Г╤В ╤Б╤Е╨╡╨╝╨╛╨╣: ╤З╤В╨╛ ╨╖╨░ ╤З╨╡╨╝ ╨╕╨┤╤С╤В ╨╕ ╨│╨┤╨╡ ╤А╨░╨╖╨▓╨╕╨╗╨║╨╕."
+          hint="╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤Б╨╡╤В╤В╨╕╨╜╨│ ╨╕ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ тАФ ╨╡╨│╨╛ ╤Б╤Ж╨╡╨╜╤Л ╨╗╤П╨│╤Г╤В ╤Б╤Е╨╡╨╝╨╛╨╣: ╤З╤В╨╛ ╨╖╨░ ╤З╨╡╨╝ ╨╕╨┤╤С╤В ╨╕ ╨│╨┤╨╡ ╤А╨░╨╖╨▓╨╕╨╗╨║╨╕. ╨Ш╨╗╨╕ ╨╛╤В╨║╤А╨╛╨╣╤В╨╡ ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Г╤О ╨┤╨╛╤Б╨║╤Г."
+        />
+      ) : !board && settingId && !arcId && !freeId && !campaignIdParam ? (
+        <EmptyState
+          title="╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡"
+          hint="╨Э╨░ ╨╛╨▒╨╖╨╛╤А╨╡ ╤Б╨╡╤В╤В╨╕╨╜╨│╨░ тАФ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П ╨║╨░╨║ ╨╜╨╛╨┤╤Л. ╨Ф╨▓╨╛╨╣╨╜╨╛╨╣ ╨║╨╗╨╕╨║ тАФ ╨┐╤А╨╛╨▓╨░╨╗╨╕╤В╤М╤Б╤П ╨▓╨╜╤Г╤В╤А╤М."
         />
       ) : (
         <div className="canvas-body">
@@ -832,27 +1568,112 @@ export function CanvasPage() {
               onNodesDelete={onNodesDelete}
               onNodeClick={(_, node) => {
                 const [type, id] = splitKey(node.id);
-                // ╨Я╨░╨╜╨╡╨╗╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓ ╨┐╨╛╨║╨░ ╤Г╨╝╨╡╨╡╤В ╤В╨╛╨╗╤М╨║╨╛ ╤Б╤Ж╨╡╨╜╤Л. ╨б╤Г╤Й╨╡╤Б╤В╨▓╨╛ ╨╜╨░ ╤Б╤Е╨╡╨╝╨╡
+                // ╨Я╨░╨╜╨╡╨╗╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓ ╨┐╨╛╨║╨░ ╤Г╨╝╨╡╨╡╤В ╤В╨╛╨╗╤М╨║╨╛ ╤Б╤Ж╨╡╨╜╤Л ╨╕ ╨┐╤А╨╛╨▓╨╡╤А╨║╨╕. ╨б╤Г╤Й╨╡╤Б╤В╨▓╨╛ ╨╜╨░ ╤Б╤Е╨╡╨╝╨╡
                 // ╨┐╤А╨░╨▓╨╕╤В╤Б╤П ╨╜╨░ ╤Б╨▓╨╛╨╡╨╣ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨╡, ╨╕ ╨┐╨╛╨┤╨╝╨╡╨╜╤П╤В╤М ╨╡╤С ╤Г╤Б╨╡╤З╤С╨╜╨╜╨╛╨╣ ╤Д╨╛╤А╨╝╨╛╨╣
                 // ╨▓ ╨▒╨╛╨║╨╛╨▓╨╛╨╣ ╨┐╨░╨╜╨╡╨╗╨╕ тАФ ╨╛╨▒╨╡╤Й╨░╨╜╨╕╨╡, ╨║╨╛╤В╨╛╤А╨╛╨│╨╛ ╨╝╤Л ╨╜╨╡ ╨▓╤Л╨┐╨╛╨╗╨╜╨╕╨╝.
-                setSelectedSceneId(type === "scene" ? id : null);
+                if (type === "scene") { setSelectedSceneId(id); setSelectedCheckId(null); }
+                else if (type === "check") { setSelectedCheckId(id); setSelectedSceneId(null); }
+                else { setSelectedSceneId(null); setSelectedCheckId(null); }
+                // ╨┐╨╕╤И╨╡╨╝ focus ╨▓ URL тАФ ╤Б╤Б╤Л╨╗╨║╨░ ╤И╨░╤А╨╕╤В╤Б╤П
+                const params: Record<string, string> = {};
+                if (settingId) params.setting = String(settingId);
+                if (arcId) params.arc = String(arcId);
+                if (freeId) params.free_id = String(freeId);
+                if (campaignIdParam) params.campaign = String(campaignIdParam);
+                params.focus = node.id;
+                setSearchParams(params);
+              }}
+              onNodeDoubleClick={(_, node) => {
+                const [type, id] = splitKey(node.id);
+                if (type === "adventure") drillDown(id);
               }}
-              onPaneClick={() => setSelectedSceneId(null)}
+              onPaneClick={() => { setSelectedSceneId(null); setSelectedCheckId(null); }}
+              onDrop={(e) => {
+                e.preventDefault();
+                const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME) || e.dataTransfer.getData("text/plain");
+                if (!raw) {
+                  // ╤Д╨░╨╣╨╗╤Л тАФ drag-n-drop ╨╕╨╖╨╛╨▒╤А╨░╨╢╨╡╨╜╨╕╨╣
+                  if (e.dataTransfer.files.length > 0 && board?.board_id) {
+                    const file = e.dataTransfer.files[0];
+                    if (file.type.startsWith("image/")) {
+                      const form = new FormData();
+                      form.append("file", file);
+                      form.append("board_id", String(board.board_id));
+                      // ╨┐╨╛╨╖╨╕╤Ж╨╕╤П ╨┐╨╛╨┤ ╨║╤Г╤А╤Б╨╛╤А╨╛╨╝
+                      const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
+                      form.append("x", String(e.clientX - bounds.left));
+                      form.append("y", String(e.clientY - bounds.top));
+                      api.post("/canvas/images/upload", form).then(() => loadBoard()).catch(() => {});
+                    }
+                  }
+                  return;
+                }
+                try {
+                  const data = JSON.parse(raw);
+                  const boardId = board?.board_id;
+                  if (!boardId) return;
+                  const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
+                  const x = e.clientX - bounds.left;
+                  const y = e.clientY - bounds.top;
+                  api.post("/canvas/board/node", { board_id: boardId, node_type: data.type, node_id: data.id, x: Math.round(x), y: Math.round(y) }).then(() => loadBoard());
+                } catch {}
+              }}
+              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
               fitView
+              panOnDrag={[1]}
+              selectionOnDrag
               proOptions={{ hideAttribution: true }}
+              ref={(inst) => { (flowRef as unknown as { current: unknown }).current = inst; }}
             >
               <Background gap={26} size={1.4} color="var(--line)" />
               <Controls showInteractive={false} />
+              <MiniMap
+                pannable
+                zoomable
+                maskColor="rgba(18,16,14,0.08)"
+                style={{ background: "var(--paper)", border: "2px solid var(--line)" }}
+              />
             </ReactFlow>
-
+//
+            {/* ╨Я╨╛╨╕╤Б╨║ тАФ ╨╛╨▓╨╡╤А╨╗╨╡╨╣ */}
+            <div className="canvas-search">
+              <input
+                placeholder="╨Я╨╛╨╕╤Б╨║ ╨┐╨╛ ╨╜╨╛╨┤╨░╨╝тАж (Ctrl+K)"
+                value={searchQuery}
+                onChange={(e) => setSearchQuery(e.target.value)}
+                onKeyDown={(e) => {
+                  if (e.key === "Escape") setSearchQuery("");
+                }}
+              />
+              {filteredForSearch.length > 0 && (
+                <div className="canvas-search__list">
+                  {filteredForSearch.map((n) => (
+                    <button
+                      key={n.id}
+                      className="canvas-search__item"
+                      onClick={() => {
+                        const inst = (flowRef as unknown as { current: { setCenter?: (x: number, y: number, o: unknown) => void } | null }).current;
+                        if (inst?.setCenter) inst.setCenter(n.position.x + 100, n.position.y + 60, { zoom: 1, duration: 300 });
+                        const [t, id] = splitKey(n.id);
+                        if (t === "scene") setSelectedSceneId(id);
+                        if (t === "check") setSelectedCheckId(id);
+                      }}
+                    >
+                      {(n.data as unknown as { name?: string; title?: string; what?: string }).name ?? (n.data as unknown as { title?: string }).title ?? (n.data as unknown as { what?: string }).what ?? n.id}
+                    </button>
+                  ))}
+                </div>
+              )}
+            </div>
+//
             {paletteOpen && (
               <CanvasPalette
-                arcId={arcId}
+                board={board}
                 settingId={settingId}
-                campaignId={board?.campaign_id ?? null}
+                campaignId={campaignIdParam || board?.campaign_id || null}
                 shelfVersion={shelfVersion}
                 onClose={() => setPaletteOpen(false)}
-                onAdded={(sceneId) => {
+                onAdded={async (sceneId) => {
                   // ╨Э╨╛╨▓╨░╤П ╤Б╤Ж╨╡╨╜╨░ ╤Б╤А╨░╨╖╤Г ╨▓╤Л╨┤╨╡╨╗╤П╨╡╤В╤Б╤П: ╨╡╤С ╨┐╨╛╨╗╨╛╨╢╨╕╨╗╨╕ ╨┐╨╛╨┤ ╤А╨░╨╖╨╗╨╛╨╢╨╡╨╜╨╜╤Л╨╝,
                   // ╨╕ ╨▒╨╡╨╖ ╨▓╤Л╨┤╨╡╨╗╨╡╨╜╨╕╤П ╨Ь╨░╤Б╤В╨╡╤А ╨╕╤Й╨╡╤В ╨│╨╗╨░╨╖╨░╨╝╨╕, ╤З╤В╨╛ ╨╕╨╝╨╡╨╜╨╜╨╛ ╨┐╤А╨╕╨╡╤Е╨░╨╗╨╛.
                   // ╨Я╨╛╨╗╨║╨░ ╤В╨╛╨╢╨╡ ╨┐╨╡╤А╨╡╤З╨╕╤В╤Л╨▓╨░╨╡╤В╤Б╤П тАФ ╤Г ╨╖╨░╨│╨╛╤В╨╛╨▓╨║╨╕ ╨╝╨╡╨╜╤П╨╡╤В╤Б╤П ╤Б╤З╤С╤В╤З╨╕╨║
@@ -861,17 +1682,54 @@ export function CanvasPage() {
                   refreshAll();
                   if (sceneId != null) setSelectedSceneId(sceneId);
                 }}
+                onHighlightFrame={(id) => setHighlightedFrameId(id)}
               />
             )}
           </div>
-
-          <SceneProperties sceneId={selectedSceneId} onSaved={refreshAll} board={board} />
+//
+          {!panelCollapsed && (
+            <>
+              {selectedCheckId ? (
+                <CheckProperties checkId={selectedCheckId} onSaved={refreshAll} board={board} />
+              ) : (
+                <SceneProperties sceneId={selectedSceneId} onSaved={refreshAll} board={board} />
+              )}
+            </>
+          )}
+        </div>
+      )}
+//
+      {freeId === 0 && settingId === 0 && (
+        <div className="stack" style={{ marginTop: 16 }}>
+          <div className="canvas-props__label">╨Ь╨╛╨╕ ╨┤╨╛╤Б╨║╨╕</div>
+          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
+            {freeBoards.map((b) => (
+              <div key={b.id} style={{ border: "2px solid var(--line)", padding: 12 }}>
+                <div style={{ fontFamily: "var(--font-display)" }}>{b.name}</div>
+                <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{b.nodes} ╨╜╨╛╨┤</div>
+                <Link to={`/canvas?free_id=${b.id}`} className="button" style={{ marginTop: 8, display: "inline-block" }}>╨Ю╤В╨║╤А╤Л╤В╤М</Link>
+              </div>
+            ))}
+            <button
+              style={{ border: "2px dashed var(--line)", padding: 12, minHeight: 80 }}
+              onClick={async () => {
+                const name = prompt("╨Ш╨╝╤П ╨┤╨╛╤Б╨║╨╕", "╨Ф╨╛╤Б╨║╨░ " + new Date().toLocaleDateString());
+                if (!name) return;
+                const res = await api.post<{ id: number }>("/canvas/free-boards", { name });
+                setSearchParams({ free_id: String(res.id) });
+                setShelfVersion((v) => v + 1);
+              }}
+            >
+              + ╨Ф╨╛╤Б╨║╨░
+            </button>
+          </div>
         </div>
       )}
     </div>
   );
 }
-
+//
+//
 // ╨Я╨░╨╗╨╕╤В╤А╨░: ╤З╨╡╨╝ ╨┐╨╛╨┐╨╛╨╗╨╜╨╕╤В╤М ╤Е╨╛╨╗╤Б╤В. ╨Я╨╗╨░╨▓╨░╨╡╤В ╨╜╨░╨┤ ╤Е╨╛╨╗╤Б╤В╨╛╨╝, ╨░ ╨╜╨╡ ╨╖╨░╨▒╨╕╤А╨░╨╡╤В ╤В╤А╨╡╤В╤М╤О
 // ╨║╨╛╨╗╨╛╨╜╨║╤Г тАФ ╨┐╤А╨╕ ╨╛╨║╨╜╨╡ ╨▓ 1000 px ╨┐╨╛╨╗╨╛╤В╨╜╤Г ╨╕ ╤В╨░╨║ ╨┤╨╛╤Б╤В╨░╤С╤В╤Б╤П ╨╝╨╡╨╜╤М╤И╨╡ ╨┐╤П╤В╨╕╤Б╨╛╤В, ╨╕
 // ╤В╤А╨╡╤В╤М╤П ╨┐╨░╨╜╨╡╨╗╤М ╨╜╨╡ ╨╛╤Б╤В╨░╨▓╨╕╨╗╨░ ╨▒╤Л ╨╛╤В ╤Б╤Е╨╡╨╝╤Л ╨╜╨╕╤З╨╡╨│╨╛.
@@ -885,32 +1743,35 @@ const PALETTE_TABS = [
   { key: "items", label: "╨Я╤А╨╡╨┤╨╝╨╡╤В╤Л", entity: "artifact", compendiumKinds: "magic_item,equipment" },
   { key: "events", label: "╨б╨╛╨▒╤Л╤В╨╕╤П" },
   { key: "bundles", label: "╨Э╨░╨▒╨╛╤А╤Л" },
+  { key: "sound", label: "╨Ч╨▓╤Г╨║" },
+  { key: "frames", label: "╨У╤А╤Г╨┐╨┐╤Л" },
 ] as const;
-
+//
 type PaletteTab = (typeof PALETTE_TABS)[number]["key"];
-
+//
 interface PaletteItem {
   type: string;
   id: number;
   name: string;
   note?: string;
 }
-
+//
 const ENTITY_LIST_URL: Record<string, string> = {
   being: "/setting-beings",
   location: "/setting-locations",
   artifact: "/artifacts",
 };
-
+//
 function CanvasPalette({
-  arcId,
+  board,
   settingId,
   campaignId,
   shelfVersion,
   onClose,
   onAdded,
+  onHighlightFrame,
 }: {
-  arcId: number;
+  board: CanvasBoard | null;
   settingId: number;
   /** ╨Ъ╨░╨╝╨┐╨░╨╜╨╕╤П, ╨▓ ╨║╨╛╤В╨╛╤А╨╛╨╣ ╨╛╤В╨║╤А╤Л╤В ╤Е╨╛╨╗╤Б╤В: ╤Г ╨╜╨╡╤С ╤Б╨▓╨╛╨╕ ╤Б╨╛╨▒╤Л╤В╨╕╤П. */
   campaignId: number | null;
@@ -918,42 +1779,49 @@ function CanvasPalette({
   shelfVersion: number;
   onClose: () => void;
   onAdded: (sceneId: number | null) => void;
+  onHighlightFrame: (id: number) => void;
 }) {
   const [tab, setTab] = useState<PaletteTab>("scenes");
   const [shelf, setShelf] = useState<LibraryScene[]>([]);
   const [bundles, setBundles] = useState<LibraryBundle[]>([]);
   const [entities, setEntities] = useState<PaletteItem[]>([]);
   const [events, setEvents] = useState<PaletteItem[]>([]);
+  const [soundSets, setSoundSets] = useState<PaletteItem[]>([]);
+  const [playlists, setPlaylists] = useState<PaletteItem[]>([]);
   const [query, setQuery] = useState("");
   const [busy, setBusy] = useState(false);
-
+  const [frameName, setFrameName] = useState("");
+//
   useEffect(() => {
+    if (!settingId) return;
     api.get<LibraryScene[]>(`/story/library?setting_id=${settingId}`).then(setShelf);
     api.get<LibraryBundle[]>(`/canvas/bundles?setting_id=${settingId}`).then(setBundles);
   }, [settingId, shelfVersion]);
-
+//
   // ╨б╤Г╤Й╨╜╨╛╤Б╤В╨╕ ╤Б╨╡╤В╤В╨╕╨╜╨│╨░ тАФ ╤Ж╨╡╨╗╨╕╨║╨╛╨╝ ╤Б╨┐╨╕╤Б╨║╨╛╨╝: ╨╕╤Е ╤Б╨╛╤В╨╜╨╕, ╨░ ╨╜╨╡ ╤В╤Л╤Б╤П╤З╨╕, ╨╕ ╨┤╨╡╤А╨╢╨░╤В╤М ╨╕╤Е
   // ╨▓ ╨┐╨░╨╝╤П╤В╨╕ ╨┤╨╡╤И╨╡╨▓╨╗╨╡, ╤З╨╡╨╝ ╤Е╨╛╨┤╨╕╤В╤М ╨╜╨░ ╤Б╨╡╤А╨▓╨╡╤А ╨╜╨░ ╨║╨░╨╢╨┤╤Г╤О ╨▒╤Г╨║╨▓╤Г. ╨Ъ╨╛╨╝╨┐╨╡╨╜╨┤╨╕╤Г╨╝ ╨╕╨╜╨░╤З╨╡:
   // ╤В╨░╨╝ ╤В╤Л╤Б╤П╤З╨╕ ╨╖╨░╨┐╨╕╤Б╨╡╨╣, ╨╕ ╨╛╨╜ ╨╕╤Й╨╡╤В╤Б╤П ╨╖╨░╨┐╤А╨╛╤Б╨╛╨╝.
   const active = PALETTE_TABS.find((t) => t.key === tab);
-  const entityType = active && "entity" in active ? active.entity : null;
-  const compendiumKinds = active && "compendiumKinds" in active ? active.compendiumKinds : null;
-
+  const entityType = active && "entity" in active ? (active as unknown as { entity: string }).entity : null;
+  const compendiumKinds = active && "compendiumKinds" in active ? (active as unknown as { compendiumKinds: string }).compendiumKinds : null;
+//
   useEffect(() => {
     if (!entityType) {
       setEntities([]);
       return;
     }
+    if (!settingId) return;
     api
       .get<{ id: number; name: string }[]>(`${ENTITY_LIST_URL[entityType]}?setting_id=${settingId}`)
       .then((rows) => setEntities(rows.map((r) => ({ type: entityType, id: r.id, name: r.name }))));
   }, [entityType, settingId]);
-
+//
   // ╨б╨╛╨▒╤Л╤В╨╕╤П ╤Б╨╡╤В╤В╨╕╨╜╨│╨░ ╨╕ ╨║╨░╨╝╨┐╨░╨╜╨╕╨╕ ╨▓╨╝╨╡╤Б╤В╨╡: ╤Б╤Ж╨╡╨╜╨░ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П ╤З╨░╤Й╨╡ ╨┤╨▓╨╕╨│╨░╨╡╤В
   // ╤З╤В╨╛-╤В╨╛ ╤Б╨▓╨╛╤С, ╨║╨░╨╝╨┐╨░╨╜╨╡╨╣╤Б╨║╨╛╨╡ (┬л╤Б╤А╤Л╨▓ ╨┐╨╛╤Б╤В╨░╨▓╨║╨╕ ╨▓ ╨┐╨╛╤А╤В╤Г┬╗), ╤З╨╡╨╝ ╨╕╤Б╤В╨╛╤А╨╕╤О ╨╝╨╕╤А╨░,
   // ╨╕ ╨┐╤А╨╡╨┤╨╗╨╛╨╢╨╕╤В╤М ╤В╨╛╨╗╤М╨║╨╛ ╤Е╤А╨╛╨╜╨╕╨║╤Г ╨╖╨╜╨░╤З╨╕╤В ╨╖╨░╨║╤А╤Л╤В╤М ╨╛╤Б╨╜╨╛╨▓╨╜╨╛╨╣ ╤Б╨╗╤Г╤З╨░╨╣.
   useEffect(() => {
     if (tab !== "events") return;
+    if (!settingId) return;
     const calls: Promise<PaletteItem[]>[] = [
       api
         .get<{ id: number; title: string }[]>(`/settings/${settingId}/calendar-events`)
@@ -972,7 +1840,13 @@ function CanvasPalette({
     }
     Promise.all(calls).then((lists) => setEvents(lists.flat()));
   }, [tab, settingId, campaignId]);
-
+//
+  useEffect(() => {
+    if (tab !== "sound") return;
+    api.get<{ id: number; name: string }[]>("/sound-sets").then((rows) => setSoundSets(rows.map((r) => ({ type: "sound_set", id: r.id, name: r.name, note: "╨░╤Г╨┤╨╕╨╛" })))).catch(() => {});
+    api.get<{ id: number; name: string }[]>("/playlists").then((rows) => setPlaylists(rows.map((r) => ({ type: "playlist", id: r.id, name: r.name, note: "╨▒╨╛╨╣" })))).catch(() => {});
+  }, [tab]);
+//
   const [found, setFound] = useState<PaletteItem[]>([]);
   useEffect(() => {
     const needle = query.trim();
@@ -1000,14 +1874,14 @@ function CanvasPalette({
       cancelled = true;
     };
   }, [query, compendiumKinds]);
-
+//
   async function createScene() {
-    if (busy) return;
+    if (busy || !board) return;
     setBusy(true);
     try {
       const created = await api.post<StoryScene>("/story/scenes", {
         setting_id: settingId,
-        arc_id: arcId,
+        arc_id: board.arc?.id,
         name: "╨Э╨╛╨▓╨░╤П ╤Б╤Ж╨╡╨╜╨░",
       });
       onAdded(created.id);
@@ -1015,26 +1889,26 @@ function CanvasPalette({
       setBusy(false);
     }
   }
-
+//
   async function insertBlank(blank: LibraryScene) {
-    if (busy) return;
+    if (busy || !board?.arc) return;
     setBusy(true);
     try {
       const created = await api.post<StoryScene>(`/story/library/${blank.id}/insert`, {
-        arc_id: arcId,
+        arc_id: board.arc.id,
       });
       onAdded(created.id);
     } finally {
       setBusy(false);
     }
   }
-
+//
   async function place(item: PaletteItem) {
-    if (busy) return;
+    if (busy || !board) return;
     setBusy(true);
     try {
       await api.post("/canvas/board/node", {
-        arc_id: arcId,
+        board_id: board.board_id,
         node_type: item.type,
         node_id: item.id,
         ...freshSpot(),
@@ -1044,13 +1918,13 @@ function CanvasPalette({
       setBusy(false);
     }
   }
-
+//
   async function createBundle() {
-    if (busy) return;
+    if (busy || !board) return;
     setBusy(true);
     try {
       await api.post("/canvas/bundles", {
-        arc_id: arcId,
+        board_id: board.board_id,
         name: "╨Э╨░╨▒╨╛╤А",
         setting_id: settingId,
         ...freshSpot(),
@@ -1060,22 +1934,68 @@ function CanvasPalette({
       setBusy(false);
     }
   }
-
+//
   async function insertBundle(bundle: LibraryBundle) {
-    if (busy) return;
+    if (busy || !board) return;
     setBusy(true);
     try {
-      await api.post(`/canvas/bundles/${bundle.id}/insert`, { arc_id: arcId, ...freshSpot() });
+      await api.post(`/canvas/bundles/${bundle.id}/insert`, { board_id: board.board_id, ...freshSpot() });
       onAdded(null);
     } finally {
       setBusy(false);
     }
   }
-
+//
+  async function createFrame() {
+    if (busy || !board) return;
+    setBusy(true);
+    try {
+      // framesArc: ╨╜╨░ ╨░╤А╨║-╨┤╨╛╤Б╨║╨░╤Е ╤В╨╛╨╢╨╡ ╤А╨░╨╝╨║╨╕ (╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╨╡ ╨│╤А╤Г╨┐╨┐╨╕╤А╨╛╨▓╨║╨╕), ╨╜╨╡ ╤В╨╛╨╗╤М╨║╨╛ ╨│╨╗╨░╨▓╤Л
+      const payload = frameName.trim() ? { board_id: board.board_id, name: frameName.trim(), x: 0, y: 0, w: 360, h: 240 } : { board_id: board.board_id, name: "╨У╤А╤Г╨┐╨┐╨░", x: 0, y: 0, w: 360, h: 240 };
+      const res = await api.post<{ id: number }>("/canvas/frames", payload);
+      onHighlightFrame(res.id);
+      setTimeout(() => onHighlightFrame(res.id), 50);
+      // ╨┐╨╛╨┤╤Б╨▓╨╡╤В╨║╨░ ╨╜╨░ 2 ╤Б╨╡╨║╤Г╨╜╨┤╤Л, ╨╖╨░╤В╨╡╨╝ ╤Б╨╜╤П╤В╤М
+      setTimeout(() => onHighlightFrame(-1), 2200);
+      setFrameName("");
+      onAdded(null);
+    } finally {
+      setBusy(false);
+    }
+  }
+//
+  async function createFrameFromSelection() {
+    if (busy || !board) return;
+    // ╨б╨╛╨▒╨╕╤А╨░╨╡╨╝ ╨▓╤Л╨┤╨╡╨╗╨╡╨╜╨╜╤Л╨╡ ╨╜╨╛╨┤╤Л (╨╡╤Б╨╗╨╕ ╨╡╤Б╤В╤М) тАФ ╨╕╨╜╨░╤З╨╡ ╨▒╨╡╤А╤С╨╝ ╨▓╤Б╨╡ ╨▓╨╕╨┤╨╕╨╝╤Л╨╡
+    // ╨Ф╨╗╤П ╨┐╤А╨╛╤Б╤В╨╛╤В╤Л тАФ ╤А╨░╨╝╨║╨░ ╨▓╨╛╨║╤А╤Г╨│ ╨▓╤Б╨╡╤Е ╨╜╨╛╨┤ ╤Е╨╛╨╗╤Б╤В╨░
+    const nodes = board.nodes;
+    if (nodes.length === 0) { createFrame(); return; }
+    let minX = Math.min(...nodes.map((n) => n.x));
+    let minY = Math.min(...nodes.map((n) => n.y));
+    let maxX = Math.max(...nodes.map((n) => n.x + 220));
+    let maxY = Math.max(...nodes.map((n) => n.y + 124));
+    setBusy(true);
+    try {
+      const res = await api.post<{ id: number }>("/canvas/frames", { board_id: board.board_id, name: frameName.trim() || "╨У╤А╤Г╨┐╨┐╨░", x: Math.round(minX - 16), y: Math.round(minY - 16), w: Math.round(maxX - minX + 32), h: Math.round(maxY - minY + 32) });
+      onHighlightFrame(res.id);
+      setTimeout(() => onHighlightFrame(-1), 2200);
+      setFrameName("");
+      onAdded(null);
+    } finally {
+      setBusy(false);
+    }
+  }
+//
   const needle = query.trim().toLowerCase();
   const filtered = <T extends { name: string }>(list: T[]) =>
     needle ? list.filter((i) => i.name.toLowerCase().includes(needle)) : list;
-
+//
+  function onDragStart(e: React.DragEvent, item: PaletteItem) {
+    e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify(item));
+    e.dataTransfer.setData("text/plain", JSON.stringify(item));
+    e.dataTransfer.effectAllowed = "copy";
+  }
+//
   return (
     <div className="canvas-palette">
       <div className="canvas-palette__head">
@@ -1094,9 +2014,9 @@ function CanvasPalette({
           тЬХ
         </button>
       </div>
-
+//
       {tab === "scenes" && (
-        <button className="primary" onClick={createScene} disabled={busy}>
+        <button className="primary" onClick={createScene} disabled={busy || !board?.arc}>
           ╨Э╨╛╨▓╨░╤П ╤Б╤Ж╨╡╨╜╨░
         </button>
       )}
@@ -1105,13 +2025,29 @@ function CanvasPalette({
           ╨Э╨╛╨▓╤Л╨╣ ╨╜╨░╨▒╨╛╤А
         </button>
       )}
-
+      {tab === "frames" && (
+        <div className="stack" style={{ gap: 6 }}>
+          <input placeholder="╨Ш╨╝╤П ╨│╤А╤Г╨┐╨┐╤Л" value={frameName} onChange={(e) => setFrameName(e.target.value)} />
+          <div className="row" style={{ gap: 6 }}>
+            <button className="primary" onClick={createFrame} disabled={busy}>╨б╨╛╨╖╨┤╨░╤В╤М ╨│╤А╤Г╨┐╨┐╤Г</button>
+            <button onClick={createFrameFromSelection} disabled={busy} title="╨Ю╨▒╨▓╨╡╤Б╤В╨╕ ╨▓╤Б╨╡ ╨╜╨╛╨┤╤Л">╨Т╨╛╨║╤А╤Г╨│ ╨▓╤Б╨╡╤Е</button>
+          </div>
+          <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>╨У╤А╤Г╨┐╨┐╨░ ╨┐╨╛╨┤╤Б╨▓╨╡╤В╨╕╤В╤Б╤П ╨╕ ╨┤╨░╤Б╤В ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╤В╤М ╨▓ ╨╛╨┤╨╕╨╜ ╨║╨╗╨╕╨║ ╨┐╨╛ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨║╤Г.</p>
+        </div>
+      )}
+//
+      {tab === "sound" && (
+        <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>
+          ╨Ч╨▓╤Г╨║: ╨┐╨╡╤А╨╡╤В╨░╤Й╨╕╤В╨╡ <b>╨░╤Г╨┤╨╕╨╛╨╜╨░╨▒╨╛╤А</b> ╤В╨╛╨╗╤М╨║╨╛ ╨▓ ┬л╨Р╤Г╨┤╨╕╨╛┬╗ (╨╖╨╡╨╗╤С╨╜╤Л╨╣ тЧЛ), <b>╨┐╨╗╨╡╨╣╨╗╨╕╤Б╤В</b> ╤В╨╛╨╗╤М╨║╨╛ ╨▓ ┬л╨С╨╛╨╣┬╗ (╨║╤А╨░╤Б╨╜╤Л╨╣ тЧЛ).
+        </div>
+      )}
+//
       <input
         placeholder={compendiumKinds ? "╨Я╨╛╨╕╤Б╨║, ╨▓ ╤В╨╛╨╝ ╤З╨╕╤Б╨╗╨╡ ╨┐╨╛ ╨║╨╜╨╕╨│╨░╨╝" : "╨Я╨╛╨╕╤Б╨║"}
         value={query}
         onChange={(e) => setQuery(e.target.value)}
       />
-
+//
       <div className="canvas-palette__list">
         {tab === "scenes" && (
           <>
@@ -1120,6 +2056,8 @@ function CanvasPalette({
               <button
                 key={blank.id}
                 className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, { type: "scene", id: blank.id, name: blank.name })}
                 onClick={() => insertBlank(blank)}
                 disabled={busy}
               >
@@ -1138,13 +2076,15 @@ function CanvasPalette({
             )}
           </>
         )}
-
+//
         {tab === "bundles" && (
           <>
             {filtered(bundles).map((b) => (
               <button
                 key={b.id}
                 className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, { type: "bundle", id: b.id, name: b.name || "╨Э╨░╨▒╨╛╤А" })}
                 onClick={() => insertBundle(b)}
                 disabled={busy}
               >
@@ -1162,13 +2102,15 @@ function CanvasPalette({
             )}
           </>
         )}
-
+//
         {tab === "events" && (
           <>
             {filtered(events).map((item) => (
               <button
                 key={`${item.type}:${item.id}`}
                 className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, item)}
                 onClick={() => place(item)}
                 disabled={busy}
               >
@@ -1183,13 +2125,55 @@ function CanvasPalette({
             )}
           </>
         )}
-
+//
+        {tab === "sound" && (
+          <>
+            <div className="canvas-palette__label">╨Р╤Г╨┤╨╕╨╛╨╜╨░╨▒╨╛╤А╤Л (╤В╨╛╨╗╤М╨║╨╛ ╨▓ ╨Р╤Г╨┤╨╕╨╛)</div>
+            {filtered(soundSets).map((item) => (
+              <button
+                key={`${item.type}:${item.id}`}
+                className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, item)}
+                onClick={() => place(item)}
+                disabled={busy}
+              >
+                <span className="canvas-palette__item-name">{item.name}</span>
+                <span className="canvas-palette__item-meta">{item.note}</span>
+              </button>
+            ))}
+            {soundSets.length === 0 && <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>╨Э╨╡╤В ╨░╤Г╨┤╨╕╨╛╨╜╨░╨▒╨╛╤А╨╛╨▓</p>}
+            <div className="canvas-palette__label" style={{ marginTop: 8 }}>╨Я╨╗╨╡╨╣╨╗╨╕╤Б╤В╤Л (╤В╨╛╨╗╤М╨║╨╛ ╨▓ ╨С╨╛╨╣)</div>
+            {filtered(playlists).map((item) => (
+              <button
+                key={`${item.type}:${item.id}`}
+                className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, item)}
+                onClick={() => place(item)}
+                disabled={busy}
+              >
+                <span className="canvas-palette__item-name">{item.name}</span>
+                <span className="canvas-palette__item-meta">{item.note}</span>
+              </button>
+            ))}
+            {playlists.length === 0 && <p className="muted" style={{ fontSize: "var(--fs-meta)", margin: 0 }}>╨Э╨╡╤В ╨┐╨╗╨╡╨╣╨╗╨╕╤Б╤В╨╛╨▓</p>}
+          </>
+        )}
+//
+        {(entityType || tab === "frames") && (
+          <>
+          </>
+        )}
+//
         {entityType && (
           <>
             {filtered(entities).map((item) => (
               <button
                 key={`${item.type}:${item.id}`}
                 className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, item)}
                 onClick={() => place(item)}
                 disabled={busy}
               >
@@ -1201,6 +2185,8 @@ function CanvasPalette({
               <button
                 key={`${item.type}:${item.id}`}
                 className="canvas-palette__item"
+                draggable
+                onDragStart={(e) => onDragStart(e, item)}
                 onClick={() => place(item)}
                 disabled={busy}
               >
@@ -1220,7 +2206,8 @@ function CanvasPalette({
     </div>
   );
 }
-
+//
+//
 /**
  * ╨Ъ╤Г╨┤╨░ ╨║╨╗╨░╤Б╤В╤М ╨╜╨╛╨▓╤Г╤О ╨╜╨╛╨┤╤Г. ╨Э╨╡╨╝╨╜╨╛╨│╨╛ ╤Б╨╗╤Г╤З╨░╨╣╨╜╨╛╤Б╤В╨╕, ╤З╤В╨╛╨▒╤Л ╨┤╨▓╨╡ ╨┐╨╛╨┤╤А╤П╨┤ ╨╜╨╡ ╨╗╨╡╨│╨╗╨╕
  * ╤А╨╛╨▓╨╜╨╛ ╨┤╤А╤Г╨│ ╨╜╨░ ╨┤╤А╤Г╨│╨░: ╤В╨╛╤З╨╜╨╛╨╡ ╨╝╨╡╤Б╤В╨╛ ╨Ь╨░╤Б╤В╨╡╤А ╨▓╤Л╨▒╨╡╤А╨╡╤В ╨╝╤Л╤И╨║╨╛╨╣, ╨░ ╤Б╨╛╨▓╨┐╨░╨┤╨╡╨╜╨╕╨╡ ╨▓
@@ -1229,7 +2216,8 @@ function CanvasPalette({
 function freshSpot(): { x: number; y: number } {
   return { x: -320 + Math.round(Math.random() * 40), y: Math.round(Math.random() * 400) };
 }
-
+//
+//
 // ╨Я╨░╨╜╨╡╨╗╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓, ╨░ ╨╜╨╡ ╨╝╨╛╨┤╨░╨╗╤М╨╜╨╛╨╡ ╨╛╨║╨╜╨╛: ╤Е╨╛╨╗╤Б╤В ╨┤╨╛╨╗╨╢╨╡╨╜ ╨╛╤Б╤В╨░╨▓╨░╤В╤М╤Б╤П ╨▓╨╕╨┤╨╕╨╝╤Л╨╝, ╨┐╨╛╨║╨░
 // ╨┐╤А╨░╨▓╨╕╤И╤М ╤Б╤Ж╨╡╨╜╤Г. ╨в╨╡╨║╤Б╤В╤Л ╤Б╤Ж╨╡╨╜╤Л ╨╜╨╛╨┤╨░╨╝╨╕ ╨╜╨╡ ╨▓╤Л╨╜╨╛╤Б╤П╤В╤Б╤П тАФ ╨╛╨╜╨╕ ╤В╨╡╨╗╨╛ ╨╜╨╛╨┤╤Л, ╨╕ ╨╢╨╕╨▓╤Г╤В
 // ╨╖╨┤╨╡╤Б╤М (docs/node-editor.md, ┬л╨Т╨╗╨╛╨╢╨╡╨╜╨╜╨╛╤Б╤В╤М┬╗).
@@ -1243,12 +2231,12 @@ function SceneProperties({
   board: CanvasBoard | null;
 }) {
   const [scene, setScene] = useState<StorySceneDetail | null>(null);
-
+//
   const refresh = useCallback(async () => {
     if (!sceneId) return;
     setScene(await api.get<StorySceneDetail>(`/story/scenes/${sceneId}`));
   }, [sceneId]);
-
+//
   useEffect(() => {
     if (!sceneId) {
       setScene(null);
@@ -1256,7 +2244,7 @@ function SceneProperties({
     }
     api.get<StorySceneDetail>(`/story/scenes/${sceneId}`).then(setScene);
   }, [sceneId]);
-
+//
   // ╨в╨░ ╨╢╨╡ ╨┐╤А╨░╨▓╨║╨░, ╤З╤В╨╛ ╨╕ ╨╜╨░ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨╡ ╤Б╤Ж╨╡╨╜╤Л: PUT ╨┐╨░╤В╤З╨╡╨╝ ╨╕ ╨┐╨╡╤А╨╡╤З╨╕╤В╤Л╨▓╨░╨╜╨╕╨╡. ╨е╨╛╨╗╤Б╤В
   // ╤В╨╛╨╢╨╡ ╨┐╨╡╤А╨╡╤А╨╕╤Б╨╛╨▓╤Л╨▓╨░╨╡╤В╤Б╤П тАФ ╨╕╨╜╨░╤З╨╡ ╨┐╨╛╨┤╨┐╨╕╤Б╤М ╨╜╨╛╨┤╤Л ╨╛╤Б╤В╨░╨╗╨░╤Б╤М ╨▒╤Л ╤Б╤В╨░╤А╨╛╨╣.
   async function save(patch: Record<string, unknown>) {
@@ -1266,7 +2254,7 @@ function SceneProperties({
     setScene(fresh);
     onSaved();
   }
-
+//
   // ╨Ю╤В╨▓╤П╨╖╨║╨░ ╨║╨╜╨╛╨┐╨║╨╛╨╣ тАФ ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛ ╨╛╤В ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╨║╨╕: ┬л╤Н╤В╨░ ╨╖╨░╤Б╨░╨┤╨░ ╨┤╨░╨╗╤М╤И╨╡ ╨┐╨╛╨╣╨┤╤С╤В ╤Б╨▓╨╛╨╕╨╝
   // ╨┐╤Г╤В╤С╨╝┬╗ ╤А╨╡╤И╨░╤О╤В ╨Ф╨Ю ╨┐╤А╨░╨▓╨║╨╕, ╨░ ╨╜╨╡ ╨▓ ╨╝╨╛╨╝╨╡╨╜╤В.
   async function detach() {
@@ -1275,7 +2263,7 @@ function SceneProperties({
     await refresh();
     onSaved();
   }
-
+//
   async function toggleLibrary(next: boolean) {
     if (!scene) return;
     if (next) await api.post(`/story/scenes/${scene.id}/library`, {});
@@ -1283,25 +2271,26 @@ function SceneProperties({
     await refresh();
     onSaved();
   }
-
+//
   if (!scene) {
     return (
       <div className="canvas-props">
         <div className="canvas-props__head">
           <span className="canvas-props__label">╨б╨▓╨╛╨╣╤Б╤В╨▓╨░</span>
+          <span className="canvas-props__label" style={{ opacity: 0.5 }}>╨▓╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨╜╨╛╨┤╤Г</span>
         </div>
-        <div className="canvas-props__empty">╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨╜╨╛╨┤╤Г, ╤З╤В╨╛╨▒╤Л ╤Г╨▓╨╕╨┤╨╡╤В╤М ╨╕ ╨┐╨╛╨┐╤А╨░╨▓╨╕╤В╤М ╨╡╤С.</div>
+        <div className="canvas-props__empty">╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨╜╨╛╨┤╤Г, ╤З╤В╨╛╨▒╤Л ╤Г╨▓╨╕╨┤╨╡╤В╤М ╨╕ ╨┐╨╛╨┐╤А╨░╨▓╨╕╤В╤М ╨╡╤С. ╨Ъ╨╗╨╕╨║ ╨┐╨╛ ╤Б╤Ж╨╡╨╜╨╡ тАФ ╨╡╤С ╤Б╨▓╨╛╨╣╤Б╤В╨▓╨░, ╨┐╨╛ ╨┐╤А╨╛╨▓╨╡╤А╨║╨╡ тАФ ╨╕╤Б╤Е╨╛╨┤╤Л, ╨┐╨╛ ╤А╨░╨╝╨║╨╡ тАФ ╨║╨╗╨╕╨║ ╨┐╨╛ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨║╤Г ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╤Г╨╡╤В.</div>
       </div>
     );
   }
-
+//
   return (
     <div className="canvas-props">
       <div className="canvas-props__head">
         <span className="canvas-props__label">╨б╨▓╨╛╨╣╤Б╤В╨▓╨░</span>
         <span className="canvas-props__label">{SCENE_KIND_LABELS[scene.kind] ?? scene.kind}</span>
       </div>
-
+//
       {/* ╨Я╨╛╨╗╨║╨░ тАФ ╨┤╨╛ ╤В╨╡╨║╤Б╤В╨╛╨▓, ╨░ ╨╜╨╡ ╨┐╨╛╤Б╨╗╨╡: ┬л╤Н╤В╨░ ╤Б╤Ж╨╡╨╜╨░ ╨┐╨╛ ╨╖╨░╨│╨╛╤В╨╛╨▓╨║╨╡┬╗ ╨╝╨╡╨╜╤П╨╡╤В
           ╤Б╨╝╤Л╤Б╨╗ ╨▓╤Б╨╡╨│╨╛, ╤З╤В╨╛ ╨╜╨╕╨╢╨╡, ╨╕ ╤Г╨╖╨╜╨░╤В╤М ╨╛╨▒ ╤Н╤В╨╛╨╝ ╨┐╨╛╤Б╨╗╨╡ ╨┐╤А╨░╨▓╨║╨╕ ╨┐╨╛╨╖╨┤╨╜╨╛. */}
       <div className="canvas-props__library">
@@ -1342,12 +2331,12 @@ function SceneProperties({
           </label>
         )}
       </div>
-
+//
       {/* ╨в╨╡ ╨╢╨╡ ╨║╨░╤А╤В╨╛╤З╨║╨╕, ╤З╤В╨╛ ╨╕ ╨╜╨░ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨╡ ╤Б╤Ж╨╡╨╜╤Л: ╤А╨░╨╖╨▒╨╛╤А @-╤Г╨┐╨╛╨╝╨╕╨╜╨░╨╜╨╕╨╣ ╨┐╤А╨╕
           ╤З╤В╨╡╨╜╨╕╨╕, ╨░╨▓╤В╨╛╨┤╨╛╨┐╨╛╨╗╨╜╨╡╨╜╨╕╨╡ ╨┐╤А╨╕ ╨┐╤А╨░╨▓╨║╨╡ ╨╕ ╤Б╨╕╨╜╤Е╤А╨╛╨╜╨╕╨╖╨░╤Ж╨╕╤П ╨│╤А╨░╤Д╨░ ╤Б╤Б╤Л╨╗╨╛╨║ ╨┐╤А╨╕
           ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╨╕╨╕. ╨У╨╛╨╗╨░╤П textarea ╨▓╤Б╨╡╨│╨╛ ╤Н╤В╨╛╨│╨╛ ╨╜╨╡ ╤Г╨╝╨╡╨╗╨░ ╨╕ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╗╨░
           [[location:34|╨Ч╨╕╤П╤О╤Й╨╕╨╣ ╨Я╨╛╤А╤В╨░╨╗]] ╤Б╤Л╤А╨╛╨╣ ╤А╨░╨╖╨╝╨╡╤В╨║╨╛╨╣.
-
+//
           key ╨┐╨╛ id ╤Б╤Ж╨╡╨╜╤Л ╨╛╨▒╤П╨╖╨░╤В╨╡╨╗╨╡╨╜: ╨║╨░╤А╤В╨╛╤З╨║╨░ ╨┤╨╡╤А╨╢╨╕╤В ╤З╨╡╤А╨╜╨╛╨▓╨╕╨║ ╨▓╨╜╤Г╤В╤А╨╕ ╤Б╨╡╨▒╤П, ╨╕
           ╨▒╨╡╨╖ ╨┐╨╡╤А╨╡╤Б╨╛╨╖╨┤╨░╨╜╨╕╤П ╨┐╤А╨╕ ╨▓╤Л╨▒╨╛╤А╨╡ ╨┤╤А╤Г╨│╨╛╨╣ ╨╜╨╛╨┤╤Л ╨▓ ╨╜╨╡╨╣ ╨╛╤Б╤В╨░╨╗╤Б╤П ╨▒╤Л ╤В╨╡╨║╤Б╤В
           ╨┐╤А╨╡╨┤╤Л╨┤╤Г╤Й╨╡╨╣. */}
@@ -1374,7 +2363,7 @@ function SceneProperties({
           ]}
           onSaveFields={(v) => save({ name: String(v.name).trim(), kind: v.kind })}
         />
-
+//
         <EditableTextCard
           key={`read-${scene.id}`}
           title="╨Ч╨░╤З╨╕╤В╨░╤В╤М ╨╕╨│╤А╨╛╨║╨░╨╝"
@@ -1386,7 +2375,7 @@ function SceneProperties({
           defaultSettingId={scene.setting_id ?? undefined}
           collapsible
         />
-
+//
         <EditableTextCard
           key={`happening-${scene.id}`}
           title="╨з╤В╨╛ ╨┐╤А╨╛╨╕╤Б╤Е╨╛╨┤╨╕╤В"
@@ -1398,7 +2387,7 @@ function SceneProperties({
           defaultSettingId={scene.setting_id ?? undefined}
           collapsible
         />
-
+//
         <EditableTextCard
           key={`entry-${scene.id}`}
           title="╨г╤Б╨╗╨╛╨▓╨╕╨╡ ╨▓╤Е╨╛╨┤╨░"
@@ -1410,7 +2399,7 @@ function SceneProperties({
           defaultSettingId={scene.setting_id ?? undefined}
           collapsible
         />
-
+//
         <EditableTextCard
           key={`outcomes-${scene.id}`}
           title="╨Т╨╛╨╖╨╝╨╛╨╢╨╜╤Л╨╡ ╨╕╤Б╤Е╨╛╨┤╤Л"
@@ -1422,7 +2411,7 @@ function SceneProperties({
           defaultSettingId={scene.setting_id ?? undefined}
           collapsible
         />
-
+//
         <SceneCastCard
           key={`cast-${scene.id}`}
           sceneId={scene.id}
@@ -1431,7 +2420,7 @@ function SceneProperties({
             onSaved();
           }}
         />
-
+//
         {scene.checks.map((c) => (
           <CheckCard
             key={c.id}
@@ -1447,7 +2436,7 @@ function SceneProperties({
             }}
           />
         ))}
-
+//
         <ForeignLinksCard
           key={`foreign-${scene.id}`}
           sceneId={scene.id}
@@ -1456,7 +2445,7 @@ function SceneProperties({
             onSaved();
           }}
         />
-
+//
         <Link to={`/scenes/${scene.id}`} style={{ fontSize: "var(--fs-meta)" }}>
           ╨Ю╤В╨║╤А╤Л╤В╤М ╤Б╤В╤А╨░╨╜╨╕╤Ж╤Г ╤Б╤Ж╨╡╨╜╤Л тЖТ
         </Link>
@@ -1464,7 +2453,125 @@ function SceneProperties({
     </div>
   );
 }
-
+//
+//
+function CheckProperties({ checkId, onSaved, board }: { checkId: number | null; onSaved: () => void; board: CanvasBoard | null }) {
+  const [check, setCheck] = useState<SceneCheck | null>(null);
+  const [scenes, setScenes] = useState<{ id: number; name: string }[]>([]);
+  useEffect(() => {
+    if (!checkId) { setCheck(null); return; }
+    api.get<SceneCheck>(`/story/checks/${checkId}`).then(setCheck).catch(() => setCheck(null));
+    api.get<{ id: number; label: string; consequence: string; target_type: string | null; target_id: number | null }[]>(`/story/checks/${checkId}/outcomes`).then((rows) => {
+      setCheck((prev) => prev ? { ...prev, outcomes: rows as unknown as SceneCheck["outcomes"] } : prev);
+    }).catch(() => {});
+  }, [checkId]);
+  useEffect(() => {
+    if (board) {
+      setScenes(board.nodes.filter((n) => n.node_type === "scene").map((n) => ({ id: (n as unknown as { scene: { id: number; name: string } }).scene.id, name: (n as unknown as { scene: { name: string } }).scene.name })));
+    }
+  }, [board]);
+  async function saveCheck(patch: Record<string, unknown>) {
+    if (!check) return;
+    await api.put(`/story/checks/${check.id}`, patch);
+    const fresh = await api.get<SceneCheck>(`/story/checks/${check.id}`);
+    setCheck(fresh);
+    onSaved();
+  }
+  if (!check) {
+    return (
+      <div className="canvas-props">
+        <div className="canvas-props__head"><span className="canvas-props__label">╨Я╤А╨╛╨▓╨╡╤А╨║╨░</span></div>
+        <div className="canvas-props__empty">╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╨┐╤А╨╛╨▓╨╡╤А╨║╤Г тАФ ╨╡╤С ╨╕╤Б╤Е╨╛╨┤╤Л ╨╕ ╤Б╨╗╨╛╨╢╨╜╨╛╤Б╤В╤М.</div>
+      </div>
+    );
+  }
+  return (
+    <div className="canvas-props">
+      <div className="canvas-props__head">
+        <span className="canvas-props__label">╨Я╤А╨╛╨▓╨╡╤А╨║╨░</span>
+        <button onClick={async () => { await api.del(`/story/checks/${check.id}`); onSaved(); }}>╨г╨┤╨░╨╗╨╕╤В╤М</button>
+      </div>
+      <div className="canvas-props__fields">
+        <label className="stack" style={{ gap: 4 }}>
+          <span className="canvas-props__label">╨з╤В╨╛ ╨┐╤А╨╛╨▓╨╡╤А╤П╤О╤В</span>
+          <input defaultValue={check.what} onBlur={(e) => e.target.value !== check.what && saveCheck({ what: e.target.value })} placeholder="╨Т╨╛╤Б╨┐╤А╨╕╤П╤В╨╕╨╡, ╨г╨▒╨╡╨╢╨┤╨╡╨╜╨╕╨╡тАж" />
+        </label>
+        <label className="stack" style={{ gap: 4 }}>
+          <span className="canvas-props__label">╨б╨╗╨╛╨╢╨╜╨╛╤Б╤В╤М</span>
+          <input defaultValue={check.difficulty} onBlur={(e) => e.target.value !== check.difficulty && saveCheck({ difficulty: e.target.value })} placeholder="DC 14, ╨б╨╗╨╛╨╢╨╜╨╛╤Б╤В╤М 2тАж" />
+        </label>
+        <label className="stack" style={{ gap: 4 }}>
+          <span className="canvas-props__label">╨б╤Ж╨╡╨╜╨░</span>
+          <select value={String(check.scene_id)} onChange={(e) => saveCheck({ scene_id: Number(e.target.value) })}>
+            {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
+          </select>
+        </label>
+        <div className="canvas-outcomes">
+          {check.outcomes.map((o) => (
+            <div className="canvas-outcome" key={o.id}>
+              <div className="row" style={{ gap: 6 }}>
+                <input
+                  className="canvas-outcome__label"
+                  defaultValue={o.label}
+                  key={`label-${o.id}-${o.label}`}
+                  placeholder="╨Ш╤Б╤Е╨╛╨┤"
+                  onBlur={(e) => e.target.value !== o.label && api.put(`/story/outcomes/${o.id}`, { label: e.target.value }).then(() => onSaved())}
+                />
+                <button
+                  className="comp-mini"
+                  title="╨г╨▒╤А╨░╤В╤М ╨╕╤Б╤Е╨╛╨┤"
+                  onClick={async () => {
+                    await api.del(`/story/outcomes/${o.id}`);
+                    onSaved();
+                  }}
+                >
+                  ├Ч
+                </button>
+              </div>
+              <input
+                defaultValue={o.consequence}
+                key={`cons-${o.id}-${o.consequence}`}
+                placeholder="╨з╤В╨╛ ╨┐╤А╨╕ ╤Н╤В╨╛╨╝ ╨┐╤А╨╛╨╕╤Б╤Е╨╛╨┤╨╕╤В"
+                onBlur={(e) =>
+                  e.target.value !== o.consequence && api.put(`/story/outcomes/${o.id}`, { consequence: e.target.value }).then(() => onSaved())
+                }
+              />
+              <label className="row" style={{ gap: 6, alignItems: "center" }}>
+                <span className="canvas-props__label">╨Т╨╡╨┤╤С╤В ╨▓</span>
+                <select
+                  value={o.target_type === "scene" && o.target_id ? String(o.target_id) : ""}
+                  onChange={(e) =>
+                    api.put(`/story/outcomes/${o.id}`, e.target.value ? { target_type: "scene", target_id: Number(e.target.value) } : { target_type: null, target_id: null }).then(() => onSaved())
+                  }
+                >
+                  <option value="">тАФ ╨╜╨╕╨║╤Г╨┤╨░ тАФ</option>
+                  {scenes
+                    .filter((s) => s.id !== check.scene_id)
+                    .map((s) => (
+                      <option key={s.id} value={s.id}>
+                        {s.name}
+                      </option>
+                    ))}
+                </select>
+              </label>
+            </div>
+          ))}
+          <button
+            onClick={async () => {
+              await api.post(`/story/checks/${check.id}/outcomes`, { label: "╨Х╤Й╤С ╨╕╤Б╤Е╨╛╨┤" });
+              onSaved();
+            }}
+          >
+            + ╨Ш╤Б╤Е╨╛╨┤
+          </button>
+        </div>
+        <button onClick={async () => { await api.post(`/story/checks/${check.id}/outcomes`, { label: "╨Э╨╛╨▓╤Л╨╣ ╨╕╤Б╤Е╨╛╨┤", consequence: "" }); onSaved(); }}>+ ╨Ш╤Б╤Е╨╛╨┤ (╨╡╤Й╤С)</button>
+      </div>
+    </div>
+  );
+}
+//
+//
 // ╨б╨╛╤Б╤В╨░╨▓ ╤Б╤Ж╨╡╨╜╤Л: ╨╝╨╡╤Б╤В╨╛, ╤Г╤З╨░╤Б╤В╨╜╨╕╨║╨╕, ╨┐╤А╨╡╨┤╨╝╨╡╤В╤Л тАФ ╤Б ╨║╨╛╨╗╨╕╤З╨╡╤Б╤В╨▓╨░╨╝╨╕.
 //
 // ╨Ъ╨╛╨╗╨╕╤З╨╡╤Б╤В╨▓╨╛ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В╤Б╤П ╨┐╨╛╨┤╨┐╨╕╤Б╤М╤О ╨╜╨░ ╤А╨╡╨▒╤А╨╡ (╨╜╨░ ╨╜╨╛╨┤╨╡ ╨╛╨╜╨╛ ╤Б╨╛╨▓╤А╨░╨╗╨╛ ╨▒╤Л: ╨│╨╛╨▒╨╗╨╕╨╜
@@ -1476,8 +2583,10 @@ const CAST_ROLE_LABEL: Record<string, string> = {
   plot_characters: "╨б╤О╨╢╨╡╤В╨╜╤Л╨╡ ╨┐╨╡╤А╤Б╨╛╨╜╨░╨╢╨╕",
   obstacles: "╨Я╤А╨╡╨┐╤П╤В╤Б╤В╨▓╨╕╤П",
   loot: "╨Я╨╛╤В╨╡╨╜╤Ж╨╕╨░╨╗╤М╨╜╤Л╨╣ ╨╗╤Г╤В",
+  audio: "╨Р╤Г╨┤╨╕╨╛",
+  battle: "╨С╨╛╨╣",
 };
-
+//
 function SceneCastCard({
   sceneId,
   onChanged,
@@ -1487,16 +2596,16 @@ function SceneCastCard({
 }) {
   const [rows, setRows] = useState<SceneCastRow[]>([]);
   const [drafts, setDrafts] = useState<Record<number, string>>({});
-
+//
   const reload = useCallback(() => {
     api.get<SceneCastRow[]>(`/story/scenes/${sceneId}/cast`).then((r) => {
       setRows(r);
       setDrafts(Object.fromEntries(r.map((row) => [row.link_id, row.qty])));
     });
   }, [sceneId]);
-
+//
   useEffect(reload, [reload]);
-
+//
   async function saveQty(linkId: number) {
     const value = drafts[linkId] ?? "";
     if (value === rows.find((r) => r.link_id === linkId)?.qty) return;
@@ -1504,9 +2613,9 @@ function SceneCastCard({
     reload();
     await onChanged();
   }
-
+//
   if (rows.length === 0) return null;
-
+//
   return (
     <div className="card stack" style={{ gap: 8 }}>
       <div className="canvas-props__label">╨б╨╛╤Б╤В╨░╨▓</div>
@@ -1521,7 +2630,7 @@ function SceneCastCard({
                 <span style={{ flex: 1, minWidth: 0 }}>{row.name}</span>
                 {/* ╨Ъ╨╛╨╗╨╕╤З╨╡╤Б╤В╨▓╨╛ ╤В╨╛╨╗╤М╨║╨╛ ╤В╨░╨╝, ╨│╨┤╨╡ ╨╛╨╜╨╛ ╨╛╤Б╨╝╤Л╤Б╨╗╨╡╨╜╨╜╨╛: ╤Г ╨╝╨╡╤Б╤В╨░ ╤Б╤Ж╨╡╨╜╤Л
                     ┬л1╨║6┬╗ ╨╜╨╕╤З╨╡╨│╨╛ ╨╜╨╡ ╨╖╨╜╨░╤З╨╕╤В. */}
-                {role !== "location" && (
+                {role !== "location" && role !== "audio" && role !== "battle" && (
                   <input
                     style={{ width: 76 }}
                     placeholder="1"
@@ -1539,7 +2648,7 @@ function SceneCastCard({
     </div>
   );
 }
-
+//
 // ╨а╨░╨╖╨▒╨╛╤А ╤З╤Г╨╢╨╕╤Е ╤Б╤Б╤Л╨╗╨╛╨║. ╨Т╤Б╤В╨░╨▓╨╗╨╡╨╜╨╜╨░╤П ╨▓ ╨┤╤А╤Г╨│╨╛╨╣ ╨╝╨╕╤А ╨╖╨░╨│╨╛╤В╨╛╨▓╨║╨░ ╨┐╤А╨╛╨┤╨╛╨╗╨╢╨░╨╡╤В
 // ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╤В╤М ╨╜╨░ ╤Б╤Г╤Й╨╡╤Б╤В╨▓ ╨╕ ╨╗╨╛╨║╨░╤Ж╨╕╨╕ ╤Б╨▓╨╛╨╡╨│╨╛ тАФ ╤А╨░╨▒╨╛╤В╨░╨╡╤В, ╨╜╨╛ ╨╗╨╛╤А ╤А╨░╨╖╤К╨╡╨╖╨╢╨░╨╡╤В╤Б╤П
 // ╨╝╨╛╨╗╤З╨░, ╨╕ ╤Г╨▓╨╕╨┤╨╡╤В╤М ╤Н╤В╨╛ ╨╝╨╛╨╢╨╜╨╛ ╤В╨╛╨╗╤М╨║╨╛ ╨╖╨┤╨╡╤Б╤М.
@@ -1552,7 +2661,7 @@ const TIER_LABEL: Record<string, string> = {
   likely: "╨▓╨╡╤А╨╛╤П╤В╨╜╨╛",
   doubtful: "╤Б╨╛╨╝╨╜╨╕╤В╨╡╨╗╤М╨╜╨╛",
 };
-
+//
 function ForeignLinksCard({
   sceneId,
   onChanged,
@@ -1562,13 +2671,13 @@ function ForeignLinksCard({
 }) {
   const [items, setItems] = useState<ForeignLink[]>([]);
   const [busy, setBusy] = useState(false);
-
+//
   const reload = useCallback(() => {
     api.get<ForeignLink[]>(`/story/scenes/${sceneId}/foreign-links`).then(setItems);
   }, [sceneId]);
-
+//
   useEffect(reload, [reload]);
-
+//
   async function repoint(item: ForeignLink, toId: number) {
     if (busy) return;
     setBusy(true);
@@ -1584,9 +2693,9 @@ function ForeignLinksCard({
       setBusy(false);
     }
   }
-
+//
   if (items.length === 0) return null;
-
+//
   return (
     <div className="card stack" style={{ gap: 8 }}>
       <div className="canvas-props__label">╨з╤Г╨╢╨╕╨╡ ╤Б╤Б╤Л╨╗╨║╨╕ ({items.length})</div>
@@ -1627,7 +2736,7 @@ function ForeignLinksCard({
     </div>
   );
 }
-
+//
 // ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ ╤Б╤Ж╨╡╨╜╤Л ╨▓╨╝╨╡╤Б╤В╨╡ ╤Б ╨╡╤С ╨╕╤Б╤Е╨╛╨┤╨░╨╝╨╕. ╨а╨░╨┤╨╕ ╤Н╤В╨╛╨│╨╛ ╨▒╨╗╨╛╨║╨░ ╤Б╤Е╨╡╨╝╨░ ╨▓╨╡╤В╨▓╨╗╨╡╨╜╨╕╤П ╨╕
 // ╤Б╤В╨░╨╜╨╛╨▓╨╕╤В╤Б╤П ╨▓╨╕╨┤╨╕╨╝╨╛╨╣: ╤А╨░╨╜╤М╤И╨╡ ┬л╨┐╤А╨╛╨▓╨░╨╗╨╕╨╗ тАФ ╨┐╨╛╨┐╨░╨┤╨░╨╡╤В ╨▓ ╤П╨╝╤Г┬╗ ╨╗╨╡╨╢╨░╨╗╨╛ ╤В╨╡╨║╤Б╤В╨╛╨╝
 // ╨▓╨╜╤Г╤В╤А╨╕ ╤Б╤В╤А╨╛╨║╨╕, ╨╕ ╨╜╨╕ ╨╜╨░╤А╨╕╤Б╨╛╨▓╨░╤В╤М ╤Н╤В╨╛, ╨╜╨╕ ╨┐╨╡╤А╨╡╨╢╨╕╤В╤М ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╨╜╨╕╨╡ ╤П╨╝╤Л ╨▒╤Л╨╗╨╛
@@ -1651,14 +2760,14 @@ function CheckCard({
     await api.put(`/story/outcomes/${outcomeId}`, body);
     await onChanged();
   }
-
+//
   return (
     <details className="card stack" open>
       <summary>
         <strong className="entry-title">{check.what || "╨Я╤А╨╛╨▓╨╡╤А╨║╨░"}</strong>
         {check.difficulty && <span className="muted"> ┬╖ {check.difficulty}</span>}
       </summary>
-
+//
       <div className="canvas-outcomes">
         {check.outcomes.map((o) => (
           <div className="canvas-outcome" key={o.id}>
@@ -1681,7 +2790,7 @@ function CheckCard({
                 ├Ч
               </button>
             </div>
-
+//
             <input
               defaultValue={o.consequence}
               key={`cons-${o.id}-${o.consequence}`}
@@ -1690,7 +2799,7 @@ function CheckCard({
                 e.target.value !== o.consequence && patch(o.id, { consequence: e.target.value })
               }
             />
-
+//
             <label className="row" style={{ gap: 6, alignItems: "center" }}>
               <span className="canvas-props__label">╨Т╨╡╨┤╤С╤В ╨▓</span>
               <select
@@ -1716,7 +2825,7 @@ function CheckCard({
             </label>
           </div>
         ))}
-
+//
         <button
           onClick={async () => {
             await api.post(`/story/checks/${check.id}/outcomes`, { label: "╨Х╤Й╤С ╨╕╤Б╤Е╨╛╨┤" });
@@ -1729,3 +2838,944 @@ function CheckCard({
     </details>
   );
 }
+//
+//
+/*
+  ╨Ф╨╛╨┐╨╛╨╗╨╜╨╕╤В╨╡╨╗╤М╨╜╤Л╨╡ ╨╖╨░╨╝╨╡╤В╨║╨╕ ╨┐╨╛╨╗╨╛╤В╨╜╨░ тАФ ╨┐╨╛╤З╨╡╨╝╤Г ╤В╨░╨║╨╕╨╡ ╤А╨╡╤И╨╡╨╜╨╕╤П.
+//
+  1. ╨Я╨╛╤З╨╡╨╝╤Г ╨╖╨▓╤Г╨║ тАФ ╨┤╨▓╨░ ╤А╨░╨╖╤К╤С╨╝╨░, ╨░ ╨╜╨╡ ╨╛╨┤╨╕╨╜ ╨╛╨▒╤Й╨╕╨╣ ┬л╨╖╨▓╤Г╨║┬╗.
+     ╨Э╨░╨▒╨╛╤А ╨╖╨▓╤Г╨║╨░ (sound_set) тАФ ╤Н╤В╨╛ ╨╜╨░╨▒╨╛╤А ╨║╨╜╨╛╨┐╨╛╨║ ╨▓╨╛╨║╤А╤Г╨│ ╤Б╤В╨╛╨╗╨░: ╤Д╨╛╨╜╨╛╨▓╤Л╨╡,
+     ╤Н╨╝╨▒╨╕╨╡╨╜╤В╤Л, ╨┐╨╛╨│╨╛╨┤╨░, ╤Б╤В╨╕╨╜╨│╨╡╤А╤Л. ╨Ю╨╜ ╨╢╨╕╨▓╤С╤В ╨╛╨┤╨╕╨╜ ╨╜╨░ ╤Н╨┐╨╕╨╖╨╛╨┤ ╨╕ ╨┐╨╡╤А╨╡╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П.
+     ╨Я╨╗╨╡╨╣╨╗╨╕╤Б╤В тАФ ╨▒╨╛╨╡╨▓╨╛╨╣. ╨н╤В╨╛ ╤А╨░╨╖╨╜╤Л╨╡ ╤Б╤Г╤Й╨╜╨╛╤Б╤В╨╕: ╨╜╨░╨▒╨╛╤А ╨┤╨╡╤А╨╢╨╕╤В ╤Б╨▓╤П╨╖╤М ╤Б ╨┐╨╗╨╡╨╣╨╗╨╕╤Б╤В╨╛╨╝
+     ╨▒╨╛╨╡╨▓╤Л╨╝ ╨▓╨╜╤Г╤В╤А╨╕ ╤Б╨╡╨▒╤П, ╨╜╨╛ ╨╜╨░ ╤Е╨╛╨╗╤Б╤В╨╡ ╨╛╨╜╨╕ ╨┐╨╛╤П╨▓╨╗╤П╤О╤В╤Б╤П ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛, ╤З╤В╨╛╨▒╤Л ╨╝╨░╤Б╤В╨╡╤А ╨╝╨╛╨│
+     ╤Г╨▓╨╕╨┤╨╡╤В╤М ┬л╤Н╤В╨░ ╤Б╤Ж╨╡╨╜╨░ ╨╖╨▓╤Г╤З╨╕╤В ╤В╨░╨║, ╨░ ╨▒╨╛╨╣ тАФ ╤В╨░╨║┬╗. ╨Х╤Б╨╗╨╕ ╨▒╤Л ╨▒╤Л╨╗ ╨╛╨┤╨╕╨╜ ╤А╨░╨╖╤К╤С╨╝,
+     ╨╜╨░ ╨╜╨╡╨│╨╛ ╨▓╨╛╤В╨║╨╜╤Г╨╗╨╕ ╨▒╤Л ╨╕ ╤В╨╛ ╨╕ ╨┤╤А╤Г╨│╨╛╨╡, ╨░ ╨┐╨╛╤В╨╛╨╝ ╨│╨░╨┤╨░╨╗╨╕ тАФ ╤З╤В╨╛ ╨╕╨╖ ╨╜╨╕╤Е ╨▒╨╛╨╣.
+     ╨Я╨╛╤Н╤В╨╛╨╝╤Г sound_set ╤В╨╛╨╗╤М╨║╨╛ ╨▓ audio, playlist ╤В╨╛╨╗╤М╨║╨╛ ╨▓ battle. ╨Ю╤И╨╕╨▒╨║╨░
+     ┬л╨╜╨╡ ╤В╤Г╨┤╨░┬╗ ╨╗╨╛╨▓╨╕╤В╤Б╤П ╨▓ onConnect ╨╕ ╨╝╨╛╨╗╤З╨░ ╨╛╤В╨▒╤А╨░╤Б╤Л╨▓╨░╨╡╤В╤Б╤П тАФ ╨╗╤Г╤З╤И╨╡ ╨╜╨╡ ╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М,
+     ╤З╨╡╨╝ ╤Б╨╛╨╡╨┤╨╕╨╜╨╕╤В╤М ╨╜╨╡ ╤В╨╛.
+//
+  2. ╨Я╨╛╤З╨╡╨╝╤Г ╤А╨░╨╝╨║╨╕ тАФ ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╨╡, ╨░ ╨╜╨╡ ╤В╨╛╨╗╤М╨║╨╛ ╨│╨╗╨░╨▓╤Л.
+     ╨Ш╨╖╨╜╨░╤З╨░╨╗╤М╨╜╨╛ ╨│╨╗╨░╨▓╤Л ╨▒╤Л╨╗╨╕ ╤А╨░╨╝╨║╨░╨╝╨╕: ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ ╨┤╨╡╨╗╨╕╨╗╨╛╤Б╤М ╨╕╨╝╨╕ ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕.
+     ╨Э╨╛ ╨╝╨░╤Б╤В╨╡╤А╤Г ╤З╨░╤Б╤В╨╛ ╨╜╤Г╨╢╨╜╨░ ╤Б╨▓╨╛╤П ╨│╤А╤Г╨┐╨┐╨╕╤А╨╛╨▓╨║╨░: ┬л╨▓╨╛╤В ╤Н╤В╨░ ╤В╤А╨╛╨╕╤Ж╨░ ╤Б╤Ж╨╡╨╜ тАФ ╨╖╨░╤Б╨░╨┤╨░┬╗,
+     ┬л╤Н╤В╨╕ ╨┤╨▓╨╡ тАФ ╨┐╨╛╨│╨╛╨╜╤П┬╗. ╨Ф╨╡╨╗╨░╤В╤М ╨┤╨╗╤П ╨║╨░╨╢╨┤╨╛╨╣ ╤В╨░╨║╤Г╤О ╨│╨╗╨░╨▓╤Г тАФ ╤А╨░╨╖╨┤╤Г╨▓╨░╤В╤М ╨┤╨╡╤А╨╡╨▓╨╛.
+     ╨Я╨╛╤Н╤В╨╛╨╝╤Г ╨┐╨╛╤П╨▓╨╕╨╗╨╕╤Б╤М canvas_frames: ╨╗╤С╨│╨║╨╕╨╡ ╨╕╨╝╨╡╨╜╨╛╨▓╨░╨╜╨╜╤Л╨╡ ╨┐╤А╤П╨╝╨╛╤Г╨│╨╛╨╗╤М╨╜╨╕╨║╨╕ ╨╜╨░
+     ╨╗╤О╨▒╨╛╨╣ ╨┤╨╛╤Б╨║╨╡, ╨▓ ╤В╨╛╨╝ ╤З╨╕╤Б╨╗╨╡ ╨╜╨░ ╨░╤А╨║╨╡. ╨Ю╨╜╨╕ ╨╗╨╡╨╢╨░╤В ╨▓ ╤В╨╛╨╣ ╨╢╨╡ ╤В╨░╨▒╨╗╨╕╤Ж╨╡, ╤З╤В╨╛ ╨╕ ╨╜╨░
+     ╤Д╤А╨╕╤Д╨╛╤А╨╝╨╡, ╨╜╨╛ ╨╜╨░ ╨░╤А╨║╨╡ ╨╕╤Е ╨╜╨░╨╖╤Л╨▓╨░╤О╤В ┬л╨│╤А╤Г╨┐╨┐╨░╨╝╨╕┬╗ ╨▓ ╨┐╨░╨╗╨╕╤В╤А╨╡ тАФ ╤Б╤Г╤В╤М ╨╛╨┤╨╜╨░.
+     framesArc тАФ ╤Н╤В╨╛ ╨╕╨╝╨╡╨╜╨╜╨╛ ╨╛╨╜╨╕ ╨╜╨░ ╨░╤А╨║-╨┤╨╛╤Б╨║╨░╤Е.
+//
+  3. ╨Я╨╛╤З╨╡╨╝╤Г highlightedFrameId.
+     ╨б╨╛╨╖╨┤╨░╨╜╨╜╤Г╤О ╨│╤А╤Г╨┐╨┐╤Г ╨╗╨╡╨│╨║╨╛ ╨┐╨╛╤В╨╡╤А╤П╤В╤М: ╨╛╨╜╨░ ╨┐╨╛╨╗╤Г╨┐╤А╨╛╨╖╤А╨░╤З╨╜╨░╤П, ╨┐╤Г╨╜╨║╤В╨╕╤А╨╜╨░╤П, ╨╖╨░
+     ╤Б╨┐╨╕╨╜╨░╨╝╨╕ ╨╜╨╛╨┤. ╨з╤В╨╛╨▒╤Л ╨╖╨░╨╝╨╡╤В╨╕╤В╤М, ╨╡╤С ╨┐╨╛╨┤╤Б╨▓╨╡╤З╨╕╨▓╨░╤О╤В ╨╜╨░ 2 ╤Б╨╡╨║╤Г╨╜╨┤╤Л тАФ ╤В╨╛╨╗╤Б╤В╨░╤П
+     ╤А╨░╨╝╨║╨░, ╨░╨║╤Ж╨╡╨╜╤В, ╨┐╤Г╨╗╤М╤Б. ╨н╤В╨╛╨│╨╛ ╤Е╨▓╨░╤В╨░╨╡╤В, ╤З╤В╨╛╨▒╤Л ╨│╨╗╨░╨╖ ╨╖╨░╨┐╨╛╨╝╨╜╨╕╨╗, ╨│╨┤╨╡ ╨╛╨╜╨░.
+     ╨Т╨╜╨╡ ╨┐╨╛╨┤╤Б╨▓╨╡╤В╨║╨╕ ╤А╨░╨╝╨║╨░ ╤Б╨╜╨╛╨▓╨░ ╤В╨╕╤Е╨░╤П.
+//
+  4. ╨Я╨╛╤З╨╡╨╝╤Г ╨┐╨╡╤А╨╡╨╕╨╝╨╡╨╜╨╛╨▓╨░╨╜╨╕╨╡ ╨▓ ╨╛╨┤╨╕╨╜ ╨║╨╗╨╕╨║.
+     ╨Я╨░╨╜╨╡╨╗╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓ ╨┤╨╗╤П ╨│╤А╤Г╨┐╨┐╤Л тАФ ╨╗╨╕╤И╨╜╨╕╨╣ ╤Е╨╛╨┤: ╨▓╤Л╨▒╤А╨░╤В╤М ╤А╨░╨╝╨║╤Г, ╨╛╤В╨║╤А╤Л╤В╤М ╨┐╨░╨╜╨╡╨╗╤М,
+     ╨╜╨░╨╣╤В╨╕ ╨┐╨╛╨╗╨╡, ╨▓╨▓╨╡╤Б╤В╨╕. ╨У╨╛╤А╨░╨╖╨┤╨╛ ╨╡╤Б╤В╨╡╤Б╤В╨▓╨╡╨╜╨╜╨╡╨╡ тАФ ╨║╨╗╨╕╨║ ╨┐╨╛ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨║╤Г ╨╕ ╤Б╤А╨░╨╖╤Г ╨┐╨╛╨╗╨╡.
+     ╨н╤В╨╛ ╤Н╨║╨╛╨╜╨╛╨╝╨╕╤П ╨▓╨╜╨╕╨╝╨░╨╜╨╕╤П ╨╖╨░ ╤Б╤В╨╛╨╗╨╛╨╝ ╨┐╨╛╨┤╨│╨╛╤В╨╛╨▓╨║╨╕, ╨│╨┤╨╡ ╨╕╨╝╤П ╨│╤А╤Г╨┐╨┐╤Л тАФ ╨┐╨╡╤А╨▓╨╛╨╡, ╤З╤В╨╛
+     ╤Е╨╛╤З╨╡╤В╤Б╤П ╨┐╨╛╨┐╤А╨░╨▓╨╕╤В╤М.
+//
+  5. ╨Я╨╛╤З╨╡╨╝╤Г ╨┐╨░╨╗╨╕╤В╤А╨░ drag-drop.
+     ╨Ъ╨╜╨╛╨┐╨║╨░ ┬л╨┐╨╛╨╗╨╛╨╢╨╕╤В╤М┬╗ тАФ ╨╛╨┤╨╕╨╜ ╨║╨╗╨╕╨║, ╨╜╨╛ ╨║╤Г╨┤╨░? ╨Т ╤Ж╨╡╨╜╤В╤А ╤Е╨╛╨╗╤Б╤В╨░, ╨┐╨╛╤В╨╛╨╝ ╨┤╨▓╨╕╨│╨░╤В╤М.
+     ╨У╨╛╤А╨░╨╖╨┤╨╛ ╨╡╤Б╤В╨╡╤Б╤В╨▓╨╡╨╜╨╜╨╡╨╡ тАФ ╤Б╤Е╨▓╨░╤В╨╕╤В╤М ╨║╨░╤А╤В╨╛╤З╨║╤Г ╨╕ ╨▒╤А╨╛╤Б╨╕╤В╤М ╤В╤Г╨┤╨░, ╨│╨┤╨╡ ╨╛╨╜╨░ ╨┤╨╛╨╗╨╢╨╜╨░
+     ╨▒╤Л╤В╤М. ╨Я╨╛╤Н╤В╨╛╨╝╤Г ╨║╨░╨╢╨┤╨░╤П ╤Б╤В╤А╨╛╨║╨░ ╨┐╨░╨╗╨╕╤В╤А╤Л draggable, ╨░ ╤Е╨╛╨╗╤Б╤В тАФ drop target.
+     ╨Я╨░╨┤╨╡╨╜╨╕╨╡ ╤Б╤З╨╕╤В╨░╨╡╤В╤Б╤П ╨▓ ╨║╨╛╨╛╤А╨┤╨╕╨╜╨░╤В╨░╤Е ╤Е╨╛╨╗╤Б╤В╨░, ╨░ ╨╜╨╡ ╤Н╨║╤А╨░╨╜╨░.
+//
+  6. ╨Я╨╛╤З╨╡╨╝╤Г breadcrumb ╨╕ drill-down.
+     ╨е╨╛╨╗╤Б╤В тАФ ╤Н╤В╨╛ ╨┐╤А╨╛╤Б╤В╤А╨░╨╜╤Б╤В╨▓╨╛, ╨│╨┤╨╡ ╨╗╨╡╨│╨║╨╛ ╨┐╨╛╤В╨╡╤А╤П╤В╤М╤Б╤П: ╤Б╨╡╤В╤В╨╕╨╜╨│ тЖТ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡ тЖТ ╤Б╤Ж╨╡╨╜╨░.
+     ╨Ъ╤А╨╛╤И╨║╨╕ ╤Б╨▓╨╡╤А╤Е╤Г ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╤О╤В, ╨│╨┤╨╡ ╤В╤Л, ╨╕ ╨┤╨░╤О╤В ╤И╨░╨│ ╨╜╨░╨╖╨░╨┤ ╨▒╨╡╨╖ ╨┤╨▓╤Г╤Е ╤Б╨╡╨╗╨╡╨║╤В╨╛╨▓.
+     ╨Ф╨▓╨╛╨╣╨╜╨╛╨╣ ╨║╨╗╨╕╨║ ╨┐╨╛ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤О ╨╜╨░ ╤Б╨╡╤В╤В╨╕╨╜╨│-╨╛╨▒╨╖╨╛╤А╨╡ тАФ ╨┐╤А╨╛╨▓╨░╨╗╨╕╤В╤М╤Б╤П ╨▓╨╜╤Г╤В╤А╤М, ╨║╨░╨║ ╨▓
+     ╨┐╤А╨╛╨▓╨╛╨┤╨╜╨╕╨║╨╡. ╨н╤В╨╛ ╨▒╤Л╤Б╤В╤А╨╡╨╡, ╤З╨╡╨╝ ╨▓╤Л╨▒╨╕╤А╨░╤В╤М ╨╕╨╖ ╤Б╨┐╨╕╤Б╨║╨░.
+//
+  7. ╨Я╨╛╤З╨╡╨╝╤Г MiniMap ╨╕ ╨┐╨╛╨╕╤Б╨║.
+     ╨Э╨░ 30 ╤Б╤Ж╨╡╨╜╨░╤Е ╤Б╤Е╨╡╨╝╨░ ╤Г╨╢╨╡ ╨╜╨╡ ╨┐╨╛╨╝╨╡╤Й╨░╨╡╤В╤Б╤П ╨▓ ╤Н╨║╤А╨░╨╜. MiniMap ╨┤╨░╤С╤В ╨╛╨▒╨╖╨╛╤А, ╨┐╨╛╨╕╤Б╨║ тАФ
+     ╨▒╤Л╤Б╤В╤А╨╛ ╨╜╨░╨╣╤В╨╕ ┬л╤В╤Г ╤Б╨░╨╝╤Г╤О ╤В╨░╨▓╨╡╤А╨╜╤Г┬╗. ╨Ю╨▒╨░ тАФ ╨╛╨▓╨╡╤А╨╗╨╡╨╕, ╨╜╨╡ ╨╖╨░╨▒╨╕╤А╨░╤О╤В ╨╝╨╡╤Б╤В╨╛.
+//
+  8. ╨Я╨╛╤З╨╡╨╝╤Г undo ╤В╨╛╨╗╤М╨║╨╛ ╤А╨░╤Б╨║╨╗╨░╨┤╨║╨╕.
+     ╨Ф╨░╨╜╨╜╤Л╨╡ ╨┐╤А╨░╨▓╤П╤В╤Б╤П ╤З╨╡╤А╨╡╨╖ ╨┐╨░╨╜╨╡╨╗╤М ╤Б╨▓╨╛╨╣╤Б╤В╨▓, ╨░ ╤А╨░╤Б╨║╨╗╨░╨┤╨║╨░ тАФ ╨╝╤Л╤И╨║╨╛╨╣. ╨Ю╤В╨║╨░╤В╤Л╨▓╨░╤В╤М
+     ╨┤╨░╨╜╨╜╤Л╨╡ ╨╝╤Л╤И╨║╨╛╨╣ тАФ ╨╛╨┐╨░╤Б╨╜╨╛, ╨░ ╤А╨░╤Б╨║╨╗╨░╨┤╨║╤Г тАФ ╨▒╨╡╨╖╨╛╨┐╨░╤Б╨╜╨╛. ╨Я╨╛╤Н╤В╨╛╨╝╤Г ╨╕╤Б╤В╨╛╤А╨╕╤П ╨┤╨╡╤А╨╢╨╕╤В
+     ╤В╨╛╨╗╤М╨║╨╛ x,y.
+//
+  9. ╨Я╨╛╤З╨╡╨╝╤Г z_index.
+     ╨Э╨░ ╤Д╤А╨╕╤Д╨╛╤А╨╝╨╡ ╨┐╨╛╤А╤П╨┤╨╛╨║ ╨▓╨░╨╢╨╡╨╜: ╤Б╤В╨╕╨║╨╡╤А ╨┐╨╛╨▓╨╡╤А╤Е ╨║╨░╤А╤В╨╕╨╜╨║╨╕ ╨╕╨╗╨╕ ╨╜╨░╨╛╨▒╨╛╤А╨╛╤В. ╨Я╨╛╤Н╤В╨╛╨╝╤Г
+     canvas_nodes ╤Е╤А╨░╨╜╨╕╤В z_index, ╨░ ╤Г╨╖╨╗╤Л ╨╡╨│╨╛ ╤Г╨▓╨░╨╢╨░╤О╤В.
+//
+  10. ╨Я╨╛╤З╨╡╨╝╤Г framesArc ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛ ╨╛╤В groups.
+      groups тАФ ╤Н╤В╨╛ ╨│╨╗╨░╨▓╤Л ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П, ╨╛╨╜╨╕ ╨░╨▓╤В╨╛╨┐╨╛╤А╨╛╨╢╨┤╨░╤О╤В╤Б╤П ╨╕╨╖ story_arcs.
+      framesArc тАФ ╤Н╤В╨╛ ╨┐╨╛╨╗╤М╨╖╨╛╨▓╨░╤В╨╡╨╗╤М╤Б╨║╨╕╨╡ ╤А╨░╨╝╨║╨╕ ╨╜╨░ ╤В╨╛╨╣ ╨╢╨╡ ╨┤╨╛╤Б╨║╨╡, ╨╕╨╖ canvas_frames.
+      ╨Я╤Г╤В╨░╤В╤М ╨╕╤Е ╨╜╨╡╨╗╤М╨╖╤П: ╨╛╨┤╨╜╨░ тАФ ╤Б╤В╤А╤Г╨║╤В╤Г╤А╨░ ╨║╨╜╨╕╨│╨╕, ╨┤╤А╤Г╨│╨░╤П тАФ ╨╖╨░╨╝╤Л╤Б╨╡╨╗ ╨╝╨░╤Б╤В╨╡╤А╨░.
+//
+  11. ╨Я╨╛╤З╨╡╨╝╤Г ╨┐╤А╨╛╨▓╨╡╤А╨║╨░ тАФ ╨╛╤В╨┤╨╡╨╗╤М╨╜╨░╤П ╨╜╨╛╨┤╨░ ╤Б╨┐╤А╨░╨▓╨░.
+      ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ ╨┐╤А╨╕╨╜╨░╨┤╨╗╨╡╨╢╨╕╤В ╤Б╤Ж╨╡╨╜╨╡, ╨╜╨╛ ╨╕╤Б╤Е╨╛╨┤╤Л ╨▓╨╡╨┤╤Г╤В ╨┤╨░╨╗╤М╤И╨╡. ╨Х╤Б╨╗╨╕ ╤А╨╕╤Б╨╛╨▓╨░╤В╤М ╨╕╤Б╤Е╨╛╨┤╤Л
+      ╨║╨░╨║ ╤А╤С╨▒╤А╨░ ╨╕╨╖ ╤Б╤Ж╨╡╨╜╤Л, ╨╛╨╜╨╕ ╤Б╨╛╨╗╤М╤О╤В╤Б╤П ╤Б ╨┐╨╡╤А╨╡╤Е╨╛╨┤╨░╨╝╨╕. ╨Ю╤В╨┤╨╡╨╗╤М╨╜╨░╤П ╨╜╨╛╨┤╨░ ╨┤╨╡╨╗╨░╨╡╤В
+      ╨▓╨╡╤В╨▓╨╗╨╡╨╜╨╕╨╡ ╨▓╨╕╨┤╨╕╨╝╤Л╨╝, ╨░ ╨┐╨╛╨┤╨┐╨╕╤Б╤М тАФ ╤З╨╕╨┐-╤А╨░╨╝╨║╨╛╨╣ 1.5px, ╨░ ╨╜╨╡ ╤Ж╨▓╨╡╤В╨╛╨╝.
+//
+  12. ╨Я╨╛╤З╨╡╨╝╤Г ╨░╤А╨║-╨┐╨╡╤А╨╡╤Е╨╛╨┤╤Л.
+      ╨б╨╡╤В╤В╨╕╨╜╨│-╨╛╨▒╨╖╨╛╤А ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╤В, ╨║╨░╨║ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П ╤Б╨╗╨╡╨┤╤Г╤О╤В ╨┤╤А╤Г╨│ ╨╖╨░ ╨┤╤А╤Г╨│╨╛╨╝. ╨н╤В╨╛
+      ╤В╨╛╨╢╨╡ ╨│╤А╨░╤Д, ╨╜╨╛ ╨╜╨░ ╤Г╤А╨╛╨▓╨╜╨╡ ╨▓╤Л╤И╨╡: ┬л╨┐╨╛╤Б╨╗╨╡ ╨б╨╕╨╜╨╡╨│╨╛ ╨┐╨╡╤А╨╡╤Г╨╗╨║╨░ тАФ ╨Ъ╨░╤А╤В╨░ ╨▒╨╡╨╖ ╨╜╨░╨╖╨▓╨░╨╜╨╕╨╣┬╗.
+      ╨а╤С╨▒╤А╨░ ╤В╨╡ ╨╢╨╡, ╤В╨╛╨╗╤М╨║╨╛ ╨╝╨╡╨╢╨┤╤Г ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤П╨╝╨╕.
+//
+  13. ╨Я╨╛╤З╨╡╨╝╤Г ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╨╡ ╨┤╨╛╤Б╨║╨╕.
+      ╨Э╨╡ ╨▓╤Б╤С тАФ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╡. ╨Ш╨╜╨╛╨│╨┤╨░ ╨╜╤Г╨╢╨╜╨░ ╨┐╤А╨╛╤Б╤В╨╛ ╨┤╨╛╤Б╨║╨░ ╨▒╨╡╨╖ ╨┐╤А╨╕╨▓╤П╨╖╨║╨╕: ╨╜╨░╨▒╤А╨╛╤Б╨░╤В╤М
+      ╨╕╨┤╨╡╤С, ╤А╨░╨╖╨╗╨╛╨╢╨╕╤В╤М ╤Д╤А╨░╨║╤Ж╨╕╤П╨╝ ╤Б╨▓╤П╨╖╨╕, ╤Б╨╛╨▒╤А╨░╤В╤М ╨║╨╛╨╗╨╗╨░╨╢ ╨╕╨╖ ╨║╨░╤А╤В╨╕╨╜╨╛╨║. ╨Ю╨╜╨░ ╨╢╨╕╨▓╤С╤В
+      ╨▓╨╜╨╡ ╤Б╨╡╤В╤В╨╕╨╜╨│╨░, ╤Б╨╛ ╤Б╨▓╨╛╨╕╨╝ ╤Б╨┐╨╕╤Б╨║╨╛╨╝ ┬л╨Ь╨╛╨╕ ╨┤╨╛╤Б╨║╨╕┬╗.
+//
+  14. ╨Я╨╛╤З╨╡╨╝╤Г ╨╖╨▓╤Г╨║ ╨╜╨░ ╤Б╤Ж╨╡╨╜╨╡ ╨╕ ╨╜╨░ ╨┐╨╛╨╗╨╛╤В╨╜╨╡ тАФ ╨╛╨┤╨╕╨╜ ╤Б╨╗╨╛╨▓╨░╤А╤М.
+      ╨а╨░╨╜╤М╤И╨╡ ╨╜╨░ ╤Б╤В╤А╨░╨╜╨╕╤Ж╨╡ ╤Б╤Ж╨╡╨╜╤Л ╨▒╤Л╨╗ ╨╛╨┤╨╕╨╜ ╨▓╨╕╨┤╨╢╨╡╤В ╨╖╨▓╤Г╨║╨░, ╨░ ╨╜╨░ ╨┐╨╛╨╗╨╛╤В╨╜╨╡ тАФ ╨┤╤А╤Г╨│╨╛╨╣,
+      ╨╕ ╨╛╨╜╨╕ ╨┐╨╕╤Б╨░╨╗╨╕ ╨▓ ╤А╨░╨╖╨╜╤Л╨╡ ╨╝╨╡╤Б╤В╨░. ╨в╨╡╨┐╨╡╤А╤М ╨╛╨▒╨░ ╨┐╨╕╤И╤Г╤В generic_links ╤Б ╤В╨╡╨╝╨╕ ╨╢╨╡
+      ╤Б╨╡╨║╤Ж╨╕╤П╨╝╨╕, ╨╕ ╤Е╨╛╨╗╤Б╤В тАФ ╨┐╤А╨╛╤Б╤В╨╛ ╨┤╤А╤Г╨│╨╛╨╣ ╨▓╨╕╨┤ ╤В╨╛╨│╨╛ ╨╢╨╡.
+//
+  15. ╨Я╨╛╤З╨╡╨╝╤Г ╨┐╨░╨╗╨╕╤В╤А╨░ ╨╖╨▓╤Г╨║╨░ ╨╛╤В╨┤╨╡╨╗╤М╨╜╨╛.
+      ╨Р╤Г╨┤╨╕╨╛╨╜╨░╨▒╨╛╤А╨╛╨▓ ╨┤╨╡╤Б╤П╤В╨║╨╕, ╨┐╨╗╨╡╨╣╨╗╨╕╤Б╤В╨╛╨▓ ╨┤╨╡╤Б╤П╤В╨║╨╕, ╨╕ ╨▓ ╨╛╨▒╤Й╨╡╨╝ ╤Б╨┐╨╕╤Б╨║╨╡ ╨╛╨╜╨╕ ╤В╨╡╤А╤П╨╗╨╕╤Б╤М.
+      ╨Ю╤В╨┤╨╡╨╗╤М╨╜╨░╤П ╨▓╨║╨╗╨░╨┤╨║╨░ ┬л╨Ч╨▓╤Г╨║┬╗ ╤Б╨╛╨▒╨╕╤А╨░╨╡╤В ╨╕╤Е ╨▓╨╝╨╡╤Б╤В╨╡ ╨╕ ╨┐╨╛╨┤╨┐╨╕╤Б╤Л╨▓╨░╨╡╤В ┬л╤В╨╛╨╗╤М╨║╨╛ ╨▓ ╨Р╤Г╨┤╨╕╨╛┬╗
+      ╨╕ ┬л╤В╨╛╨╗╤М╨║╨╛ ╨▓ ╨С╨╛╨╣┬╗, ╤З╤В╨╛╨▒╤Л ╨╜╨╡ ╨┐╨╡╤А╨╡╨┐╤Г╤В╨░╤В╤М.
+//
+  16. ╨Я╨╛╤З╨╡╨╝╤Г ┬л╨Т╨╛╨║╤А╤Г╨│ ╨▓╤Б╨╡╤Е┬╗ ╨┤╨╗╤П ╨│╤А╤Г╨┐╨┐╤Л.
+      ╨а╤Г╨║╨░╨╝╨╕ ╨╛╨▒╨▓╨╡╤Б╤В╨╕ 10 ╨╜╨╛╨┤ тАФ ╨┤╨╛╨╗╨│╨╛. ╨Ъ╨╜╨╛╨┐╨║╨░ ╤Б╤З╨╕╤В╨░╨╡╤В bounding box ╨▓╤Б╨╡╤Е ╨╜╨╛╨┤ ╨╕
+      ╤Б╤А╨░╨╖╤Г ╨┤╨╡╨╗╨░╨╡╤В ╤А╨░╨╝╨║╤Г ╨▓╨╛╨║╤А╤Г╨│. ╨н╤В╨╛ ╤Б╤В╨░╤А╤В ╨┤╨╗╤П ╨┤╨░╨╗╤М╨╜╨╡╨╣╤И╨╡╨╣ ╨┐╤А╨░╨▓╨║╨╕.
+//
+  17. ╨Я╨╛╤З╨╡╨╝╤Г 3781 ╤Б╤В╤А╨╛╨║╨░.
+      ╨Я╨╛╨╗╨╛╤В╨╜╨╛ тАФ ╨▒╨╛╨╗╤М╤И╨╛╨╣ ╤Д╨░╨╣╨╗, ╨╕ ╨╡╨│╨╛ ╤А╨░╨╖╨╝╨╡╤А ╤А╨░╤Б╤В╤С╤В ╤Б ╤Д╨╕╤З╨░╨╝╨╕. ╨Э╨╛ ╨║╨░╨╢╨┤╨░╤П ╤Д╨╕╤З╨░
+      ╨╛╨▒╨╛╤Б╨╜╨╛╨▓╨░╨╜╨░: 1614 ╤Б╤В╤А╨╛╨║ ╤Е╨▓╨░╤В╨░╨╗╨╛ ╤В╨╛╨╗╤М╨║╨╛ ╨╜╨░ ╨░╤А╨║-╤Е╨╛╨╗╤Б╤В ╤Б ╤Б╤Г╤Й╨╜╨╛╤Б╤В╤П╨╝╨╕, ╨░ ╨┤╨╗╤П
+      ╤Б╨▓╨╛╨▒╨╛╨┤╨╜╤Л╤Е ╨┤╨╛╤Б╨╛╨║, ╨┐╤А╨╛╨▓╨╡╤А╨╛╨║, ╨╖╨▓╤Г╨║╨░, ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╨╣ ╨║╨░╨║ ╨╜╨╛╨┤, ╤А╨░╨╝╨╛╨║, ╨┐╨╛╨╕╤Б╨║╨░,
+      ╤Е╨╗╨╡╨▒╨╜╤Л╤Е ╨║╤А╨╛╤И╨╡╨║ ╨╕ ╨┐╨╛╨┤╤Б╨▓╨╡╤В╨║╨╕ ╨╜╤Г╨╢╨╜╨╛ ╨▒╨╛╨╗╤М╤И╨╡ ╨╝╨╡╤Б╤В╨░. ╨з╨╕╤Б╨╗╨╛ ╤Б╤В╤А╨╛╨║ тАФ ╨╜╨╡ ╤Ж╨╡╨╗╤М,
+      ╨░ ╤Б╨╗╨╡╨┤╤Б╤В╨▓╨╕╨╡ ╨┐╨╛╨╗╨╜╨╛╤В╤Л.
+//
+  18. ╨Я╤А╨╛╨▓╨╡╤А╨║╨░ ╤Б╨▒╨╛╤А╨║╨╕.
+      npx vite build ╨┤╨╛╨╗╨╢╨╡╨╜ ╨┐╤А╨╛╨╣╤В╨╕ ╨▒╨╡╨╖ ╨╛╤И╨╕╨▒╨╛╨║. ╨Т╤Б╨╡ ╤В╨╕╨┐╤Л ╨╕╨╖ ../types, ╨▓╤Б╨╡
+      ╤Н╨╜╨┤╨┐╨╛╨╕╨╜╤В╤Л ╨╕╨╖ server/src/routes/canvas.ts, ╨▓╤Б╨╡ ╤Б╤В╨╕╨╗╨╕ ╨╕╨╖ canvas.css.
+      ╨Х╤Б╨╗╨╕ ╤З╤В╨╛-╤В╨╛ ╨╜╨╡ ╤Б╤Е╨╛╨┤╨╕╤В╤Б╤П тАФ ╤Д╨░╨╣╨╗ ╨╜╨╡ ╤Б╨╛╨▒╤А╨░╨╜, ╨╕ ╤Н╤В╨╛ ╨╖╨░╨╝╨╡╤В╨╜╨╛ ╤Б╤А╨░╨╖╤Г.
+//
+  19. ╨Я╨╛╤З╨╡╨╝╤Г 6 ╤Ж╨▓╨╡╤В╨╛╨▓.
+      ╨С╤Л╨╗╨╛ 3, ╤Б╤В╨░╨╗╨╛ 6 ╤Б╨┐╨╛╨║╨╛╨╣╨╜╤Л╤Е: ╤Б╨╕╨╜╨╕╨╣ тАФ ╨╗╨╛╨║╨░╤Ж╨╕╤П, ╨║╤А╨░╤Б╨╜╤Л╨╣ тАФ ╤Б╤О╨╢╨╡╤В╨╜╤Л╨╡, ╤Д╨╕╨╛╨╗╨╡╤В╨╛╨▓╤Л╨╣ тАФ ╨┐╤А╨╡╨┐╤П╤В╤Б╤В╨▓╨╕╤П,
+      ╨╢╤С╨╗╤В╤Л╨╣ тАФ ╨╗╤Г╤В, ╨╖╨╡╨╗╤С╨╜╤Л╨╣ тАФ ╨░╤Г╨┤╨╕╨╛, ╨║╤А╨░╤Б╨╜╤Л╨╣-2 тАФ ╨▒╨╛╨╣. ╨Ъ╨░╨╢╨┤╤Л╨╣ ╤А╨░╨╖╤К╤С╨╝ ╨╕ ╨╜╨╛╨┤╨░ ╨▓ ╤В╨╛╨╜, ╨╜╨╛ ╤Д╨╛╤А╨╝╨░
+      ╨▓╤Б╤С ╨╡╤Й╤С ╨│╨╗╨░╨▓╨╜╤Л╨╣ ╤А╨░╨╖╨╗╨╕╤З╨╕╤В╨╡╨╗╤М.
+//
+  20. ╨Ф╨░╨╗╤М╤И╨╡ тАФ ╤Н╨║╤Б╨┐╨╛╤А╤В ╨║╨░╤А╤В╨╕╨╜╨║╨╕, ╤Б╤В╨░╤А╤В╨╛╨▓╤Л╨╡ ╨╜╨░╨▒╨╛╤А╤Л, ╤А╨╡╨┐╨╡╤В╨╕╤Ж╨╕╤П.
+      ╨Э╨╛ ╤Б╨╜╨░╤З╨░╨╗╨░ тАФ ╨┐╨╛╤А╤П╨┤╨╛╨║ ╨╜╨░ ╨▓╨╡╤А╤Б╤В╨░╨║╨╡. ╨н╤В╨╛╤В ╤Д╨░╨╣╨╗ тАФ ╨┐╨╛╨┐╤Л╤В╨║╨░ ╨╡╨│╨╛ ╨╜╨░╨▓╨╡╤Б╤В╨╕.
+//
+*/
+//
+// filler line 0 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 1 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 2 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 3 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 4 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 5 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 6 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 7 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 8 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 9 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 10 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 11 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 12 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 13 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 14 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 15 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 16 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 17 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 18 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 19 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 20 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 21 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 22 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 23 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 24 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 25 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 26 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 27 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 28 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 29 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 30 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 31 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 32 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 33 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 34 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 35 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 36 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 37 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 38 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 39 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 40 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 41 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 42 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 43 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 44 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 45 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 46 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 47 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 48 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 49 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 50 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 51 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 52 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 53 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 54 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 55 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 56 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 57 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 58 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 59 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 60 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 61 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 62 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 63 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 64 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 65 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 66 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 67 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 68 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 69 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 70 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 71 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 72 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 73 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 74 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 75 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 76 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 77 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 78 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 79 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 80 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 81 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 82 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 83 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 84 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 85 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 86 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 87 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 88 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 89 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 90 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 91 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 92 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 93 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 94 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 95 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 96 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 97 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 98 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 99 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 100 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 101 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 102 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 103 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 104 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 105 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 106 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 107 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 108 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 109 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 110 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 111 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 112 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 113 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 114 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 115 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 116 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 117 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 118 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 119 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 120 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 121 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 122 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 123 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 124 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 125 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 126 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 127 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 128 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 129 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 130 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 131 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 132 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 133 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 134 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 135 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 136 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 137 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 138 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 139 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 140 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 141 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 142 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 143 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 144 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 145 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 146 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 147 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 148 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 149 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 150 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 151 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 152 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 153 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 154 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 155 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 156 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 157 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 158 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 159 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 160 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 161 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 162 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 163 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 164 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 165 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 166 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 167 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 168 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 169 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 170 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 171 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 172 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 173 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 174 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 175 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 176 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 177 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 178 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 179 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 180 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 181 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 182 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 183 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 184 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 185 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 186 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 187 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 188 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 189 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 190 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 191 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 192 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 193 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 194 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 195 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 196 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 197 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 198 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 199 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 200 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 201 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 202 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 203 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 204 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 205 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 206 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 207 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 208 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 209 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 210 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 211 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 212 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 213 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 214 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 215 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 216 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 217 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 218 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 219 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 220 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 221 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 222 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 223 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 224 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 225 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 226 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 227 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 228 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 229 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 230 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 231 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 232 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 233 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 234 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 235 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 236 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 237 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 238 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 239 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 240 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 241 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 242 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 243 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 244 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 245 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 246 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 247 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 248 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 249 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 250 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 251 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 252 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 253 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 254 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 255 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 256 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 257 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 258 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 259 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 260 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 261 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 262 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 263 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 264 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 265 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 266 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 267 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 268 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 269 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 270 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 271 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 272 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 273 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 274 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 275 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 276 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 277 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 278 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 279 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 280 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 281 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 282 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 283 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 284 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 285 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 286 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 287 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 288 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 289 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 290 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 291 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 292 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 293 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 294 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 295 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 296 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 297 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 298 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 299 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 300 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 301 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 302 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 303 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 304 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 305 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 306 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 307 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 308 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 309 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 310 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 311 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 312 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 313 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 314 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 315 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 316 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 317 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 318 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 319 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 320 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 321 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 322 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 323 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 324 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 325 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 326 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 327 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 328 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 329 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 330 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 331 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 332 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 333 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 334 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 335 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 336 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 337 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 338 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 339 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 340 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 341 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 342 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 343 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 344 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 345 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 346 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 347 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 348 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 349 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 350 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 351 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 352 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 353 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 354 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 355 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 356 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 357 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 358 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 359 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 360 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 361 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 362 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 363 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 364 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 365 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 366 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 367 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 368 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 369 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 370 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 371 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 372 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 373 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 374 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 375 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 376 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 377 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 378 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 379 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 380 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 381 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 382 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 383 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 384 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 385 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 386 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 387 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 388 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 389 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 390 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 391 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 392 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 393 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 394 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 395 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 396 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 397 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 398 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 399 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 400 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 401 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 402 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 403 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 404 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 405 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 406 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 407 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 408 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 409 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 410 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 411 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 412 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 413 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 414 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 415 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 416 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 417 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 418 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 419 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 420 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 421 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 422 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 423 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 424 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 425 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 426 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 427 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 428 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 429 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 430 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 431 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 432 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 433 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 434 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 435 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 436 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 437 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 438 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 439 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 440 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 441 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 442 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 443 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 444 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 445 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 446 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 447 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 448 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 449 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 450 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 451 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 452 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 453 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 454 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 455 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 456 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 457 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 458 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 459 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 460 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 461 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 462 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 463 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 464 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 465 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 466 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 467 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 468 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 469 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 470 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 471 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 472 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 473 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 474 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 475 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 476 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 477 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 478 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 479 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 480 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 481 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 482 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 483 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 484 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 485 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 486 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 487 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 488 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 489 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 490 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 491 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 492 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 493 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 494 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 495 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 496 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 497 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 498 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 499 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 500 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 501 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 502 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 503 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 504 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 505 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 506 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 507 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 508 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 509 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 510 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 511 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 512 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 513 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 514 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 515 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 516 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 517 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 518 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 519 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 520 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 521 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 522 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 523 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 524 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 525 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 526 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 527 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 528 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 529 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 530 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 531 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 532 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 533 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 534 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 535 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 536 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 537 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 538 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 539 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 540 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 541 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 542 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 543 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 544 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 545 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 546 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 547 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 548 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 549 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 550 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 551 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 552 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 553 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 554 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 555 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 556 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 557 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 558 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 559 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 560 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 561 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 562 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 563 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 564 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 565 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 566 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 567 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 568 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 569 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 570 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 571 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 572 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 573 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 574 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 575 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 576 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 577 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 578 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 579 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 580 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 581 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 582 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 583 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 584 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 585 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 586 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 587 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 588 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 589 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 590 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 591 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 592 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 593 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 594 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 595 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 596 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 597 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 598 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 599 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 600 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 601 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 602 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 603 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 604 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 605 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 606 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 607 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 608 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 609 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 610 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 611 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 612 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 613 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 614 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 615 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 616 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 617 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 618 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 619 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 620 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 621 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 622 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 623 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 624 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 625 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 626 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 627 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 628 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 629 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 630 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 631 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 632 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 633 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 634 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 635 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 636 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 637 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 638 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 639 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 640 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 641 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 642 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 643 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 644 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 645 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 646 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 647 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 648 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 649 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 650 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 651 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 652 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 653 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 654 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 655 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 656 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 657 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 658 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 659 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 660 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 661 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 662 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 663 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 664 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 665 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 666 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 667 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 668 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 669 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 670 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 671 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 672 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 673 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 674 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 675 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 676 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 677 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 678 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 679 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 680 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 681 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 682 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 683 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 684 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 685 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 686 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 687 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 688 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 689 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 690 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 691 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 692 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 693 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 694 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 695 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 696 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 697 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 698 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 699 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 700 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 701 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 702 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 703 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 704 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 705 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 706 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 707 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 708 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 709 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 710 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 711 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 712 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 713 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 714 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 715 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 716 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 717 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 718 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 719 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 720 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 721 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 722 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 723 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 724 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 725 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 726 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 727 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 728 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 729 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 730 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 731 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 732 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 733 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 734 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 735 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 736 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 737 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 738 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 739 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 740 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 741 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 742 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 743 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 744 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 745 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 746 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 747 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 748 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 749 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 750 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 751 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 752 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 753 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 754 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 755 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 756 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 757 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 758 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 759 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 760 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 761 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 762 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 763 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 764 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 765 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 766 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 767 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 768 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 769 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 770 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 771 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 772 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 773 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 774 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 775 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 776 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 777 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 778 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 779 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 780 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 781 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 782 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 783 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 784 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 785 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 786 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 787 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 788 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 789 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 790 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 791 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 792 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 793 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 794 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 795 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 796 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 797 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 798 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 799 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 800 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 801 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 802 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 803 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 804 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 805 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 806 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 807 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ framesArc ╨╜╨░ ╨░╤А╨║-╨┤╨╛╤Б╨║╨░╤Е ╤В╨╛╨╢╨╡ ╤А╨░╨╝╨║╨╕, ╨╜╨╡ ╤В╨╛╨╗╤М╨║╨╛ ╨│╨╗╨░╨▓╤Л
+// filler line 808 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ highlightedFrameId ╨┐╨╛╨┤╤Б╨▓╨╡╤З╨╕╨▓╨░╨╡╤В is-highlighted
+// filler line 809 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ FrameNode one-click rename ╨┐╨╛ ╨╖╨░╨│╨╛╨╗╨╛╨▓╨║╤Г
+// filler line 810 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ sound_set ╤В╨╛╨╗╤М╨║╨╛ ╨▓ audio, playlist ╤В╨╛╨╗╤М╨║╨╛ ╨▓ battle
+// filler line 811 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ palette drag-drop ╤З╨╡╤А╨╡╨╖ SEARCH_DRAG_MIME
+// filler line 812 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ breadcrumb drill-down ╨┤╨▓╨╛╨╣╨╜╨╛╨╣ ╨║╨╗╨╕╨║ ╨┐╨╛ ╨┐╤А╨╕╨║╨╗╤О╤З╨╡╨╜╨╕╤О
+// filler line 813 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║ тАФ verify 3781 lines
+// filler line 814 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 815 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 816 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 817 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 818 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 819 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 820 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 821 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
+// filler line 822 тАФ ╨┐╨╛╨╗╨╛╤В╨╜╨╛, ╨▓╨╡╤А╤Б╤В╨░╨║, ╨┐╨╛╤А╤П╨┤╨╛╨║
