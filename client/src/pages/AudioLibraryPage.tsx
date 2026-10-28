import {useState} from "react";
import {useAudioOwnership} from "../sound/audioOwnership";
import {PageFrame} from "../components/PageFrame";
import {SectionBackground} from "../components/SectionBackground";
import {SoundLibraryTab} from "../components/SoundLibraryTab";
import {SoundSetsTab} from "../components/SoundSetsTab";
export function AudioLibraryPage(){
 const [tab,setTab]=useState("sounds");
 const ownership=useAudioOwnership();
 return <PageFrame section="resources" title="Аудиотека"><SectionBackground/>
 <div className="tabs"><button className={tab==="sounds"?"active":""} onClick={()=>setTab("sounds")}>Звуки</button><button className={tab==="sets"?"active":""} onClick={()=>setTab("sets")}>Наборы</button></div>
 {ownership?.scope==="all" && <p className="muted" role="status">Прослушивание приостановлено катсценой. После завершения запустите его заново.</p>}
 {tab==="sounds"?<SoundLibraryTab/>:<SoundSetsTab/>}
 </PageFrame>;
}
