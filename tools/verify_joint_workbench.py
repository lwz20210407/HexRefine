"""Browser plugin unavailable; use the preinstalled isolated Playwright runtime."""
import argparse,hashlib,json,os,re
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

def main(URL,ROOT,executable):
    parsed=urlsplit(URL)
    if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost'):raise ValueError('Only local workbench QA is supported')
    origin=parsed.scheme+'://'+parsed.netloc
    ROOT=Path(ROOT).resolve();ROOT.mkdir(exist_ok=False)
    os.environ['TEMP']=str(ROOT);os.environ['TMP']=str(ROOT)
    result=dict(url=URL,browserPath='Existing Playwright: Browser plugin not available',consoleErrors=[],pageErrors=[])
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=str(executable),headless=True,
                                  args=['--enable-unsafe-swiftshader'])
        context=browser.new_context(viewport=dict(width=1440,height=1000),accept_downloads=True)
        page=context.new_page()
        post_requests=[]
        page.on('request',lambda request:post_requests.append(request.url) if request.method=='POST' and request.url.endswith('/api/native-joint/jobs') else None)
        page.on('console',lambda msg:result['consoleErrors'].append(msg.text) if msg.type=='error' else None)
        page.on('pageerror',lambda exc:result['pageErrors'].append(str(exc)))
        page.goto(URL,wait_until='networkidle');page.get_by_role('button',name='装配参数',exact=True).wait_for()
        page.get_by_role('button',name='装配参数',exact=True).click()
        dialog=page.locator('#native-joint-dialog');dialog.wait_for(state='visible')
        result['title']=page.title();page.screenshot(path=str(ROOT/'gui-parameters.png'))
        for name,value in dict(thread_length='16.1',nut_height='13.1',shank_length='8.2').items():
            dialog.locator(f'input[name="{name}"]').fill(value)
        dialog.get_by_role('button',name='生成',exact=True).click()
        dialog.get_by_role('link',name='下载 K',exact=True).wait_for(timeout=120000)
        href=dialog.get_by_role('link',name='下载 K',exact=True).get_attribute('href')
        identity=href.split('/')[4];result['jobId']=identity
        job=page.request.get(origin+f'/api/native-joint/jobs/{identity}').json()
        result['jobState']=job['state'];result['quality']=job['report']['quality'];result['parts']=job['report']['parts']
        assert job['state']=='succeeded' and job['report']['quality']['elements']==53592
        assert '20 / 20' in dialog.locator('.nj-quality').inner_text()
        assert '0.2 mm' in dialog.locator('.nj-quality').inner_text()
        with page.expect_download() as event:dialog.get_by_role('link',name='下载 K',exact=True).click()
        event.value.save_as(ROOT/'gui-generated.k')
        result['downloadKSHA256']=hashlib.sha256((ROOT/'gui-generated.k').read_bytes()).hexdigest()
        assert result['downloadKSHA256']==job['report']['kReadback']['sha256']
        with page.expect_download() as event:dialog.get_by_role('link',name='装配 INP',exact=True).click()
        event.value.save_as(ROOT/'gui-generated.inp')
        assert hashlib.sha256((ROOT/'gui-generated.inp').read_bytes()).hexdigest()==job['report']['inpSHA256']['merged.inp']
        page.screenshot(path=str(ROOT/'gui-result-dialog.png'))
        dialog.get_by_role('button',name='关闭装配参数',exact=True).click()
        page.wait_for_timeout(600);page.screenshot(path=str(ROOT/'gui-preview.png'))
        import numpy as np
        from PIL import Image
        image=np.asarray(Image.open(ROOT/'gui-preview.png').convert('RGB'))[:,:1100].astype(int)
        blue=(image[:,:,2]>130)&(image[:,:,0]<130)&(image[:,:,1]<140)&(image[:,:,2]-image[:,:,0]>40)
        result['modelBluePixels']=int(blue.sum());assert result['modelBluePixels']>2000
        result['reportText']=page.locator('#report').inner_text();assert '53592' in result['reportText'] and '56704' in result['reportText']
        page.get_by_role('button',name='装配参数',exact=True).click()
        dialog.locator('select[name="connection_mode"]').select_option('separate')
        assert dialog.get_by_role('link',name='下载 K',exact=True).count()==0
        dialog.get_by_role('button',name='生成',exact=True).click()
        dialog.get_by_role('link',name='下载 K',exact=True).wait_for(timeout=120000)
        separate_id=dialog.get_by_role('link',name='下载 K',exact=True).get_attribute('href').split('/')[4]
        separate=page.request.get(origin+f'/api/native-joint/jobs/{separate_id}').json()
        assert separate['report']['connectionMode']=='separate' and separate['report']['nodeOwnership']['componentNodeSetsDisjoint']
        assert separate['report']['quality']['elements']==53592 and separate['report']['quality']['nodes']>56704
        result['separateJobId']=separate_id;result['separateQuality']=separate['report']['quality']
        assert '分件（无耦合）' in dialog.locator('.nj-quality').inner_text()
        page.screenshot(path=str(ROOT/'gui-separate.png'))
        before_posts=len(post_requests)
        page.reload(wait_until='networkidle');page.get_by_role('button',name='装配参数',exact=True).click()
        dialog.locator('select[name="joint_history"]').select_option(separate_id)
        dialog.get_by_role('button',name='打开结果',exact=True).click()
        dialog.get_by_role('link',name='下载 K',exact=True).wait_for(timeout=120000)
        assert dialog.get_by_role('link',name='下载 K',exact=True).get_attribute('href').split('/')[4]==separate_id
        assert dialog.locator('select[name="connection_mode"]').input_value()=='separate'
        assert dialog.locator('input[name="thread_length"]').input_value()=='16.1'
        assert len(post_requests)==before_posts
        result['refreshReopenedWithoutGeneration']=True
        page.screenshot(path=str(ROOT/'gui-recovered.png'))
        dialog.locator('input[name="plate_x"]').fill('20');dialog.get_by_role('button',name='生成',exact=True).click()
        dialog.locator('.nj-message').filter(has_text='Rectangle').wait_for(timeout=60000)
        result['invalidInputError']=dialog.locator('.nj-message').inner_text()
        assert dialog.get_by_role('link',name='下载 K',exact=True).count()==0
        page.screenshot(path=str(ROOT/'gui-invalid.png'))
        page.evaluate('''() => { const original=window.fetch.bind(window);window.fetch=async(...args)=>{
          const response=await original(...args);if(args[0]==='/api/native-joint/jobs'&&args[1]?.method==='POST')
            await new Promise(resolve=>setTimeout(resolve,1500));return response;};}''')
        result['cancelTestResponseDelayMs']=1500
        dialog.locator('input[name="plate_x"]').fill('40');dialog.locator('input[name="sector"]').fill('4')
        dialog.locator('input[name="axial_per_pitch"]').fill('20');dialog.get_by_role('button',name='生成',exact=True).click()
        dialog.get_by_role('button',name='取消任务',exact=True).click()
        page.locator('.nj-status').filter(has_text='已取消').wait_for(timeout=60000)
        result['cancelled']=True;assert dialog.get_by_role('link',name='下载 K',exact=True).count()==0
        page.set_viewport_size(dict(width=390,height=844));dialog.get_by_role('button',name='恢复默认',exact=True).click()
        result['mobileOverflow']=page.evaluate('document.querySelector("#native-joint-dialog").scrollWidth>document.querySelector("#native-joint-dialog").clientWidth')
        page.screenshot(path=str(ROOT/'gui-mobile.png'))
        absent=context.new_page()
        absent.route('**/examples/browser/runtime-config.js',lambda route:route.fulfill(content_type='text/javascript',body='window.HEXREFINE_RUNTIME={appMode:"internal",guiElementLimit:null};window.COMFORMHEX_RUNTIME=window.HEXREFINE_RUNTIME;'))
        requests=[];absent.on('request',lambda request:requests.append(request.url) if '/api/native-joint/' in request.url else None)
        absent.goto(URL,wait_until='networkidle')
        assert absent.get_by_role('button',name='装配参数',exact=True).is_disabled()
        result['capabilityOffNetworkRequests']=len(requests);assert not requests
        absent.screenshot(path=str(ROOT/'gui-backend-unavailable.png'))
        assert not result['mobileOverflow'] and not result['pageErrors'] and not result['consoleErrors'],result
        context.close();browser.close()
    result['passed']=True;(ROOT/'gui-qa.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8');print(json.dumps(result,ensure_ascii=True))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--url',required=True)
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--browser',type=Path,required=True)
    args=parser.parse_args();main(args.url,args.output,args.browser)
