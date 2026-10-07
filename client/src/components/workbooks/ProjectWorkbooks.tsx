import {Link,useNavigate} from "react-router-dom";
import {useAction,useResource,write} from "../../data/hooks";
import type {InstanceSummary} from "./model";
export function ProjectWorkbooks({type,id,inline=false}:{type:"campaign"|"setting"|"adventure";id:number;inline?:boolean}){
 const query=useResource<InstanceSummary[]>(`/workbooks/instances?project_type=${type}&project_id=${id}`),run=useAction(),navigate=useNavigate();
 async function start(){const result=await run(()=>write.post<{id:number}>(`/workbooks/projects/${type}/${id}/notebook`,{}),{affects:[{path:"/workbooks"},{path:"/book-library"}],retry:false});if(result&&!inline)navigate(`/workbooks/${result.id}`);}
 return <section className="card stack"><strong>Тетради</strong>{query.error?<p role="alert">{query.error}</p>:query.data?.length?query.data.map(w=><Link key={w.id} to={`/workbooks/${w.id}`}>{w.title} →</Link>):query.data?<button type="button" className="wb-link" onClick={()=>void start()}>Создать рабочую тетрадь</button>:<p className="muted">Открываем тетради…</p>}</section>;
}
