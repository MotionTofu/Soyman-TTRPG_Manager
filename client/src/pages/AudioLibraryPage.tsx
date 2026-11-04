import {useState} from "react";
import {useAudioOwnership} from "../sound/audioOwnership";
import {useResource} from "../data/hooks";
import {PageFrame} from "../components/PageFrame";
import {SectionBackground} from "../components/SectionBackground";
import {SoundLibraryTab} from "../components/SoundLibraryTab";
import {SoundSetsTab} from "../components/SoundSetsTab";
import type {SoundButton, SoundSetSummary} from "../sound/types";
export function AudioLibraryPage(){
 // ?set=ID — ссылка на набор (ПКМ набора на холсте): сразу «Наборы» и он.
 const [tab,setTab]=useState(()=>new URLSearchParams(window.location.search).has("set")?"sets":"sounds");
 const ownership=useAudioOwnership();
 // Счётчики на ярлыках (макет «Д» Roll-Audio); те же ресурсы, что у вкладок.
 const soundCount=useResource<SoundButton[]>("/sounds").data?.length;
 const setCount=useResource<SoundSetSummary[]>("/sound-sets").data?.length;
 return <PageFrame section="resources" title="Аудиотека"><SectionBackground/>
 <div className="d-tabbed"><div className="tabs d-tabs"><button className={tab==="sounds"?"active":""} onClick={()=>setTab("sounds")}>Звуки{soundCount!==undefined&&<b>{soundCount}</b>}</button><button className={tab==="sets"?"active":""} onClick={()=>setTab("sets")}>Наборы{setCount!==undefined&&<b>{setCount}</b>}</button></div>
 <div className="d-sheet">
 {ownership?.scope==="all" && <p className="muted" role="status">Прослушивание приостановлено катсценой. После завершения запустите его заново.</p>}
 {tab==="sounds"?<SoundLibraryTab/>:<SoundSetsTab/>}
 </div></div>
 </PageFrame>;
}
