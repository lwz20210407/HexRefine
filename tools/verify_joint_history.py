"""Reopen a completed local GUI job without creating another mesh or download."""
import argparse,json,os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright


def verify(url,output,browser_path,identity):
    parsed=urlsplit(url)
    if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost'):raise ValueError('Loopback workbench required')
    if len(identity)!=32 or any(c not in '0123456789abcdef' for c in identity):raise ValueError('Invalid job ID')
    output=Path(output).resolve();output.mkdir(exist_ok=False)
    os.environ['TEMP']=os.environ['TMP']=str(output)
    evidence=dict(jobId=identity,postRequests=[],consoleErrors=[],pageErrors=[],browserPath='Existing Playwright: Browser plugin not available')
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(browser_path),headless=True,args=['--enable-unsafe-swiftshader'])
        try:
            page=browser.new_page(viewport=dict(width=1440,height=1000))
            page.on('request',lambda r:evidence['postRequests'].append(r.url) if r.method=='POST' else None)
            page.on('console',lambda m:evidence['consoleErrors'].append(m.text) if m.type=='error' else None)
            page.on('pageerror',lambda error:evidence['pageErrors'].append(str(error)))
            for repeat in range(2):
                page.goto(url,wait_until='networkidle')
                page.get_by_role('button',name='装配参数',exact=True).click()
                dialog=page.locator('#native-joint-dialog')
                dialog.locator('select[name="joint_history"]').select_option(identity)
                dialog.get_by_role('button',name='打开结果',exact=True).click()
                link=dialog.get_by_role('link',name='下载 K',exact=True);link.wait_for(timeout=60000)
                assert link.get_attribute('href').split('/')[4]==identity
                assert dialog.locator('select[name="connection_mode"]').input_value()=='separate'
                assert dialog.locator('input[name="thread_length"]').input_value()=='16.1'
                assert '61120' in dialog.locator('.nj-quality').inner_text()
                page.screenshot(path=str(output/f'history-dialog-{repeat}.png'))
                dialog.get_by_role('button',name='关闭装配参数',exact=True).click()
                assert '61120' in page.locator('#report').inner_text()
                page.screenshot(path=str(output/f'history-preview-{repeat}.png'))
            origin=parsed.scheme+'://'+parsed.netloc
            inventory=page.request.get(origin+'/api/native-joint/jobs').json()['jobs']
            evidence['restored']=next(j['restored'] for j in inventory if j['id']==identity)
            evidence['repeatedOpenCount']=2
            assert not evidence['postRequests'] and not evidence['consoleErrors'] and not evidence['pageErrors']
            evidence['recoveryPostRequests']=list(evidence['postRequests'])
            expected=page.request.get(origin+'/api/native-joint/jobs/'+identity).json()['report']['parameters']
            page.set_viewport_size(dict(width=390,height=844));page.get_by_role('button',name='装配参数',exact=True).click()
            assert not page.evaluate('document.querySelector("#native-joint-dialog").scrollWidth>document.querySelector("#native-joint-dialog").clientWidth')
            page.screenshot(path=str(output/'history-mobile.png'))
            # Probe resubmission without allocating another complete mesh.
            submissions=[]
            def capture(route):
                if route.request.method!='POST':route.continue_();return
                submissions.append(route.request.post_data_json)
                route.fulfill(status=202,content_type='application/json',body=json.dumps(dict(id='f'*32,state='failed',error='QA request capture')))
            page.route(origin+'/api/native-joint/jobs',capture)
            dialog=page.locator('#native-joint-dialog')
            dialog.get_by_role('button',name='生成',exact=True).click()
            dialog.locator('.nj-message').filter(has_text='QA request capture').wait_for()
            assert submissions[0]['parameters']==expected
            assert submissions[0]['schemaVersion']==1
            evidence['resubmissionPreservesAllParameters']=True
            dialog.get_by_role('button',name='恢复默认',exact=True).click()
            dialog.get_by_role('button',name='生成',exact=True).click()
            dialog.locator('.nj-message').filter(has_text='QA request capture').wait_for()
            assert 'taper_length' not in submissions[1]['parameters']
            assert submissions[1]['parameters']['connection_mode']=='shared'
            evidence['resetClearsRecoveredParameters']=True
            evidence['capturedSubmissionsNotGenerated']=len(submissions)
            assert len(submissions)==2 and not evidence['consoleErrors'] and not evidence['pageErrors']
            evidence['passed']=True
        finally:browser.close()
    (output/'history-qa.json').write_text(json.dumps(evidence,indent=2),encoding='utf8')
    print(json.dumps(evidence))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--browser',type=Path,required=True);parser.add_argument('--job',required=True)
    args=parser.parse_args();verify(args.url,args.output,args.browser,args.job)
