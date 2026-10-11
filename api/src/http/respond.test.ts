import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AppError} from '../domain/errors';
import {respond} from './respond';

beforeEach(()=>{ vi.spyOn(console,'error').mockImplementation(()=>{}); });
afterEach(()=>vi.restoreAllMocks());
const generic = {status:500,body:{error:{code:'internal',message:'Internal server error.'}}};

describe('content-safe HTTP failures',()=>{
  it('hides explicit internal messages and details from both response and diagnostic',async()=>{
    const result=await respond(200,async()=>{throw new AppError('internal','secret-token-value',{request:'private user text'});});
    expect(result).toEqual(generic);
    expect(console.error).toHaveBeenCalledExactlyOnceWith({event:'api.unexpected_error',category:'unexpected'});
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-token-value');
  });

  it('retains safe validation messages and details without error-level logging',async()=>{
    const result=await respond(200,async()=>{throw new AppError('validation','A title is required.',{field:'title'});});
    expect(result).toEqual({status:400,body:{error:{code:'validation',message:'A title is required.',details:{field:'title'}}}});
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    [{code:400,message:'The query needs a composite index. secret-value'},'missing_composite_index',400],
    [{statusCode:403,message:'contains sensitive URL'},'dependency_auth',403],
    [{code:401},'dependency_auth',401],
    [{code:429},'throttled',429],
    [{code:500,message:'composite index'},'unexpected',500],
    [{code:999,message:'403 429 private'},'unexpected',undefined],
    [{code:'403'},'unexpected',undefined],
    [{code:NaN},'unexpected',undefined],
    [{code:400.5},'unexpected',undefined],
  ])('logs only bounded fields for dependency failure %#',async(error,category,dependencyStatus)=>{
    expect(await respond(200,async()=>{throw error;})).toEqual(generic);
    expect(console.error).toHaveBeenCalledExactlyOnceWith({event:'api.unexpected_error',category,...(dependencyStatus===undefined?{}:{dependencyStatus})});
  });

  it('does not let malformed diagnostic properties escape the response boundary',async()=>{
    const error=Object.defineProperty({},'code',{get:()=>{throw new Error('sensitive getter');}});
    expect(await respond(200,async()=>{throw error;})).toEqual(generic);
  });

  it('does not let logger failure replace the safe response',async()=>{
    vi.mocked(console.error).mockImplementation(()=>{throw new Error('Logging failed');});
    expect(await respond(200,async()=>{throw new Error('private details');})).toEqual(generic);
  });
});