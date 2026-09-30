import type { MasteringBook } from "../../types";
export interface LibraryDepartment {id:number;uid:string;name:string;position:number;legacy_key:string|null}
export interface LibraryShelf {id:number;uid:string;name:string;department_id:number|null;legacy_section_id:number|null;position:number;descending:number}
export interface LibraryBook extends MasteringBook {key:string;source_type:"mastering"|"resource"|"workbook";source_id:number;department_id:number|null;shelf_id:number|null;department_name:string|null;format:"pdf"|"markdown"|"workbook";bookmarked:boolean;last_opened:string|null;position:Record<string,unknown>;mode:string|null}
export interface LibraryCatalog {books:LibraryBook[];total:number;offset:number;limit:number}
export const LIBRARY_AFFECTS = [{path:"/book-library"}] as const;
