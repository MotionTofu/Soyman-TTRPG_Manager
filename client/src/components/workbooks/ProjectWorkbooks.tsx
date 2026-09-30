import {Link} from "react-router-dom";
import {useResource} from "../../data/hooks";
import type {InstanceSummary} from "./model";
export function ProjectWorkbooks({type,id}:{type:"campaign"|"setting"|"adventure";id:number}){const query=useResource<InstanceSummary[]>(`/workbooks/instances?project_type=${type}&project_id=${id}`);return query.data?.length?<div className="card stack"><strong>Рабочие тетради</strong>{query.data.map(w=><Link key={w.id} to={`/workbooks/${w.id}`}>{w.title} →</Link>)}</div>:null;}
