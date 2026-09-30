import {useState} from "react";
import {PageFrame} from "../components/PageFrame";
import {SectionBackground} from "../components/SectionBackground";
import {SoundLibraryTab} from "../components/SoundLibraryTab";
import {SoundSetsTab} from "../components/SoundSetsTab";
export function AudioLibraryPage(){
 const [tab,setTab]=useState("sounds");
 return <PageFrame section="resources" title="Аудиотека"><SectionBackground/>
 <div className="tabs"><button className={tab==="sounds"?"active":""} onClick={()=>setTab("sounds")}>Звуки</button><button className={tab==="sets"?"active":""} onClick={()=>setTab("sets")}>Наборы</button></div>
 {tab==="sounds"?<SoundLibraryTab/>:<SoundSetsTab/>}
 </PageFrame>;
}
