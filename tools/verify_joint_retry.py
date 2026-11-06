"""Real fresh-regeneration browser QA from an explicit interrupted-record fixture."""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit
import uuid


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare(jobs_root):
    root=Path(jobs_root).resolve(strict=True)
    if not root.is_dir() or any(root.iterdir()):raise ValueError('Prepare requires a new empty owned jobs root before host startup')
    identity=uuid.uuid4().hex;directory=root/identity;directory.mkdir()
    request=dict(schemaVersion=1,parameters=dict(connection_mode='separate',taper_length=2.0,handedness='left'))
    raw=json.dumps(request,indent=2).encode()
    (directory/'request.json').write_bytes(raw)
    (directory/'partial-output.txt').write_text('QA interrupted-record fixture. No prior child or partial mesh is claimed.\n')
    record=dict(schemaVersion=1,id=identity,state='running',error=None,created=time.time(),
                requestSHA256=hashlib.sha256(raw).hexdigest(),pid=99999999)
    (directory/'job.json').write_text(json.dumps(record,indent=2))
    result=dict(sourceJob=identity,jobsRoot=str(root),fixture='saved-running-record; no original worker started or adopted',
                requestSHA256=record['requestSHA256'])
    (root.parent/'retry-fixture.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))


def verify(url,output,browser_path,jobs_root,identity,server_pid=None):
    parsed=urlsplit(url)
    if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost'):raise ValueError('Loopback URL required')
    if len(identity)!=32 or any(c not in '0123456789abcdef' for c in identity):raise ValueError('Invalid source UUID')
    root=Path(jobs_root).resolve(strict=True);source=root/identity
    if not source.is_dir() or source.is_symlink():raise ValueError('Actual source job directory required')
    out=Path(output).resolve();out.mkdir(exist_ok=False)
    os.environ['TEMP']=os.environ['TMP']=str(out)
    from playwright.sync_api import sync_playwright
    import numpy as np
    from PIL import Image
    import meshio
    from tools.bolthex.truegrid_screw import read_keyword
    def fingerprints():
        return {str(p.relative_to(source)):dict(sha256=digest(p),mtimeNs=p.stat().st_mtime_ns)
                for p in source.rglob('*') if p.is_file()}
    before=fingerprints();raw=(source/'request.json').read_bytes();request=json.loads(raw)
    origin=parsed.scheme+'://'+parsed.netloc
    result=dict(url=url,serverPID=server_pid,sourceJob=identity,
        browser='Existing isolated headless Playwright; Browser plugin not available',
        fixture='Interrupted saved-record fixture, not a real crash or checkpoint-resume claim',
        actualFreshGeneration=True,checkpointContinuation=False,storedPIDAdopted=False,
        consoleErrors=[],pageErrors=[],expectedErrors=[],requests=[])
    phase={'mockError':False};created=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(browser_path),headless=True,args=['--enable-unsafe-swiftshader'])
        context=browser.new_context(viewport=dict(width=1440,height=1000),accept_downloads=True)
        page=context.new_page()
        def console(message):
            if message.type!='error':return
            target=result['expectedErrors'] if phase['mockError'] and '409' in message.text else result['consoleErrors']
            target.append(message.text)
        page.on('console',console);page.on('pageerror',lambda error:result['pageErrors'].append(str(error)))
        page.on('request',lambda req:result['requests'].append(dict(url=req.url,body=req.post_data_json))
                if req.method=='POST' and '/api/native-joint/' in req.url else None)
        try:
            page.goto(url,wait_until='networkidle')
            baseline_ids={j['id'] for j in page.request.get(origin+'/api/native-joint/jobs').json()['jobs']}
            result['pageTitle']=page.title()
            page.get_by_role('button',name='装配参数',exact=True).click()
            dialog=page.locator('#native-joint-dialog');history=dialog.locator('[name="joint_history"]')
            history.select_option(identity)
            retry=dialog.get_by_role('button',name='重新生成',exact=True)
            assert retry.is_enabled() and dialog.get_by_role('button',name='打开结果',exact=True).is_disabled()
            assert '非断点续跑' in dialog.locator('[data-nj="history-status"]').inner_text()
            assert dialog.locator('.nj-downloads a').count()==0
            page.screenshot(path=str(out/'retry-interrupted-desktop.png'))
            # Retry must ignore current form edits and use the immutable saved request.
            dialog.locator('input[name="diameter"]').fill('18')
            retry.click()
            link=dialog.get_by_role('link',name='下载 K',exact=True);link.wait_for(timeout=120000)
            child=link.get_attribute('href').split('/')[4];created.append(child)
            done=page.request.get(origin+'/api/native-joint/jobs/'+child).json()
            assert child!=identity and done['state']=='succeeded'
            assert done['parentJobId']==identity and done['retryMode']=='fresh-regeneration'
            assert done['parentRequestSHA256']==hashlib.sha256(raw).hexdigest()
            assert (root/child/'request.json').read_bytes()==raw
            assert done['report']['parameters']['diameter']==16
            assert done['report']['parameters']['taper_length']==2.
            assert done['report']['parameters']['handedness']=='left'
            assert done['report']['connectionMode']=='separate'
            assert dialog.locator('input[name="diameter"]').input_value()=='16'
            assert fingerprints()==before
            parent=page.request.get(origin+'/api/native-joint/jobs/'+identity).json()
            assert parent['state']=='interrupted' and 'files' not in parent
            result.update(childJob=child,parentLinkage=done['parentJobId'],state=done['state'],quality=done['report']['quality'])
            result['downloadHashes']={}
            for name,label in [('model.k','下载 K'),('merged.inp','装配 INP'),('parts.inp','分件 INP'),('report.json','审计报告')]:
                with page.expect_download() as event:dialog.get_by_role('link',name=label,exact=True).click()
                event.value.save_as(out/name)
                result['downloadHashes'][name]=digest(out/name)
            assert result['downloadHashes']['model.k']==done['report']['kReadback']['sha256']
            for name in ('merged.inp','parts.inp'):assert result['downloadHashes'][name]==done['report']['inpSHA256'][name]
            mesh=read_keyword(out/'model.k');inp=meshio.read(out/'merged.inp',file_format='abaqus')
            np.testing.assert_array_equal(mesh.elements,inp.get_cells_type('hexahedron'))
            error=float(np.max(np.abs(mesh.nodes-inp.points)));assert error<=1e-10
            assert len(mesh.elements)==10440 and len(set(mesh.part_ids))==4
            result['readback']=dict(nodes=len(mesh.nodes),H8=len(mesh.elements),exactConnectivity=True,
                maximumCoordinateDifference=error,PIDs=sorted(map(int,set(mesh.part_ids))),
                readers=['repository K reader','meshio Abaqus'],solverVerified=False,engineeringQualityAccepted=False)
            page.screenshot(path=str(out/'retry-generated-desktop.png'))
            dialog.get_by_role('button',name='关闭装配参数',exact=True).click()
            page.wait_for_timeout(500);page.screenshot(path=str(out/'retry-preview.png'))
            pixels=np.asarray(Image.open(out/'retry-preview.png').convert('RGB'))[:,:1100].astype(int)
            blue=(pixels[:,:,2]>130)&(pixels[:,:,0]<130)&(pixels[:,:,1]<140)&(pixels[:,:,2]-pixels[:,:,0]>40)
            result['modelBluePixels']=int(blue.sum());assert result['modelBluePixels']>500
            assert '10440' in page.locator('#report').inner_text()
            count=len(result['requests']);page.reload(wait_until='networkidle')
            page.get_by_role('button',name='装配参数',exact=True).click();history.select_option(child)
            dialog.get_by_role('button',name='打开结果',exact=True).click();link.wait_for(timeout=60000)
            assert len(result['requests'])==count and link.get_attribute('href').split('/')[4]==child
            result['reopenCreatesNoJob']=True
            dialog.get_by_role('button',name='刷新记录',exact=True).click()
            assert dialog.locator('.nj-downloads a').count()==0
            result['historyRefreshClearsStaleLinks']=True
            history.select_option(identity);assert dialog.locator('.nj-downloads a').count()==0
            result['historyChangeClearsStaleLinks']=True
            # Deliberate browser-only error fixture; never counted as backend evidence.
            phase['mockError']=True
            page.route('**/api/native-joint/jobs/'+identity+'/retry',lambda route:route.fulfill(
                status=409,content_type='application/json',body=json.dumps(dict(error='QA deliberate busy response'))))
            retry.click();dialog.locator('.nj-message').filter(has_text='QA deliberate busy response').wait_for()
            assert dialog.locator('.nj-downloads a').count()==0
            page.screenshot(path=str(out/'retry-error.png'))
            page.unroute('**/api/native-joint/jobs/'+identity+'/retry');phase['mockError']=False
            result['simulated409ClearsLinks']=True
            page.evaluate('''() => {const original=window.fetch.bind(window);window.fetch=async(...args)=>{
                const response=await original(...args);if(String(args[0]).endsWith('/retry')&&args[1]?.method==='POST')
                await new Promise(resolve=>setTimeout(resolve,1500));return response;};}''')
            with page.expect_request(lambda req:req.method=='POST' and req.url.endswith('/retry')):retry.click()
            dialog.get_by_role('button',name='取消任务',exact=True).click()
            page.wait_for_function('document.querySelector("[data-nj=history-refresh]").disabled === false',timeout=60000)
            inventory=page.request.get(origin+'/api/native-joint/jobs').json()['jobs']
            cancelled=[j for j in inventory if j.get('parentJobId')==identity and j['id']!=child and j['id'] not in baseline_ids]
            assert len(cancelled)==1 and cancelled[0]['state'] in ('cancelled','succeeded')
            created.append(cancelled[0]['id']);result['cancelledJob']=cancelled[0]
            result['cancelArrivedBeforePostResponse']=True
            assert dialog.locator('.nj-downloads a').count()==0 and fingerprints()==before
            page.screenshot(path=str(out/'retry-cancel.png'))
            page.set_viewport_size(dict(width=390,height=844));history.select_option(identity)
            assert retry.is_enabled() and dialog.locator('.nj-downloads a').count()==0
            retry.scroll_into_view_if_needed()
            assert retry.evaluate('(button)=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button}')
            result['mobileOverflow']=dialog.evaluate('(element)=>element.scrollWidth>element.clientWidth')
            assert not result['mobileOverflow']
            page.screenshot(path=str(out/'retry-mobile.png'))
            assert not result['consoleErrors'] and not result['pageErrors'],result
            result.update(sourceFolderUnchanged=True,sourceFiles=before,passed=True)
        finally:
            # Only cancel new jobs created by this verifier; never touch stored PIDs.
            for child in created:
                current=page.request.get(origin+'/api/native-joint/jobs/'+child).json()
                if current.get('state')=='running':page.request.delete(origin+'/api/native-joint/jobs/'+child)
            context.close();browser.close()
    (out/'retry-qa.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8')
    def escape(value):return html.escape(str(value))
    figures=''.join(f'<figure><figcaption>{escape(name)}</figcaption><img src="{name}" alt="{escape(name)}"></figure>'
        for name in ('retry-interrupted-desktop.png','retry-generated-desktop.png','retry-preview.png','retry-error.png','retry-cancel.png','retry-mobile.png'))
    page_html=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Native joint fresh retry QA</title><style>body{{font:15px/1.6 system-ui;max-width:1050px;margin:auto;padding:20px;overflow-wrap:anywhere}}img{{max-width:100%;height:auto}}figure{{margin:20px 0}}.scope{{border-left:4px solid #3d7186;padding:12px;background:#eff5f7}}pre{{white-space:pre-wrap}}</style>
<h1>中断任务重新生成：真实新UUID与K/INP</h1><p class="scope">这是从保存的中断记录夹具发起的真实完整重新生成，不是旧半网格/进程checkpoint续跑。旧PID未接管，父目录保留。仅检查参数、网格及IO；R11/scikit-fem不是依赖或前置条件，物理分析独立可选。任务成功不升级为CAD/solver/接触/预紧或工程质量认证。</p>
<p>URL <a href="{escape(url)}">{escape(url)}</a>；server PID {escape(server_pid)}。</p>
<p>parent {identity}<br>fresh child {result['childJob']}<br>{len(mesh.nodes)} nodes / {len(mesh.elements)} H8 / 4 PIDs；K/INP exact connectivity，max coordinate difference {error:.9g}。</p>
<p><a href="retry-qa.json">实际QA与源目录哈希</a> · <a href="model.k">真实K下载</a> · <a href="merged.inp">真实装配INP</a> · <a href="parts.inp">真实分件INP</a> · <a href="report.json">生成报告</a></p>
<p>浏览器错误场景的409为明确标注的模拟；并发/错误状态的真实服务端检查见HTTP测试日志。取消在POST返回前发出，实际终态 {escape(result['cancelledJob']['state'])}。截图来自隔离headless浏览器，未操作用户LSPP。</p>{figures}</html>'''
    (out/'REVIEW.html').write_text(page_html,encoding='utf8')
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(browser_path),headless=True)
        try:
            page=browser.new_page();page.goto((out/'REVIEW.html').as_uri(),wait_until='load')
            page.evaluate('async()=>{await Promise.all([...document.images].map(image=>image.decode()))}')
            assert page.locator('img').count()==6
            local=[href for href in page.locator('a').evaluate_all('(links)=>links.map(a=>a.getAttribute("href"))')
                   if not href.startswith(('http:','https:','#'))]
            assert all((out/href).is_file() for href in local)
            for name,width,height in [('desktop',1440,1000),('mobile',390,844)]:
                page.set_viewport_size(dict(width=width,height=height))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(out/f'report-{name}.png'),full_page=True)
            result['htmlQA']=dict(localLinks=len(local),decodedImages=6,desktopAndMobilePassed=True)
        finally:browser.close()
    (out/'retry-qa.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8')
    print(json.dumps({k:v for k,v in result.items() if k not in ('sourceFiles','requests')},ensure_ascii=True))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    fixture=sub.add_parser('prepare');fixture.add_argument('--jobs-root',type=Path,required=True)
    run=sub.add_parser('verify');run.add_argument('--url',required=True);run.add_argument('--output',type=Path,required=True)
    run.add_argument('--browser',type=Path,required=True);run.add_argument('--jobs-root',type=Path,required=True)
    run.add_argument('--job',required=True);run.add_argument('--server-pid',type=int)
    args=parser.parse_args()
    if args.command=='prepare':prepare(args.jobs_root)
    else:verify(args.url,args.output,args.browser,args.jobs_root,args.job,args.server_pid)
