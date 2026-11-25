// Preview/test storage only; production uses the managed R2 binding.
export class MockBucket {
  value=null; revision=0;
  async get(){if(this.value===null)return null;const value=this.value;return {etag:String(this.revision),json:async()=>JSON.parse(value)};}
  async put(key,value,options){const condition=options?.onlyIf;if(condition?.etagMatches!==undefined && condition.etagMatches!==String(this.revision))return null;if(condition?.etagDoesNotMatch==='*'&&this.value!==null)return null;this.value=value;return {etag:String(++this.revision)};}
}
