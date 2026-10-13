/* Draft integration; install only together with ocPost_ / ocGet_ backend. */
(function () {
  'use strict';
  var busy = false;
  function randomHex(bytes) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),function(n) {
      return n.toString(16).padStart(2,'0');
    }).join('');
  }
  function pause(ms) { return new Promise(function(resolve) { setTimeout(resolve,ms); }); }
  function response(endpoint,key) {
    return new Promise(function(resolve) {
      var callback = 'ocResponse_'+randomHex(16), script = document.createElement('script');
      var timer = setTimeout(function(){finish(null);},12000);
      function finish(value) {
        clearTimeout(timer);script.remove();delete window[callback];resolve(value);
      }
      window[callback] = finish;
      script.onerror = function(){finish(null);};
      var url = new URL(endpoint);
      url.searchParams.set('response_key',key);url.searchParams.set('callback',callback);
      script.src = url.href;script.referrerPolicy = 'no-referrer';document.head.appendChild(script);
    });
  }
  async function token(config) {
    for (var i=0;i<100 && !window.turnstile;i++) await pause(100);
    if (!window.turnstile) throw Error('Verification could not load. Please try again.');
    return new Promise(function(resolve,reject) {
      var id, settled=false;
      var timer=setTimeout(function(){finish(Error('Verification timed out. Please try again.'));},120000);
      function finish(error,value) {
        if(settled)return;settled=true;clearTimeout(timer);
        if(error){if(id!=null)turnstile.remove(id);reject(error);}else resolve({value:value,id:id});
      }
      var box=document.getElementById('oc-turnstile');box.replaceChildren();
      id=turnstile.render(box,{
        sitekey:config.sitekey,action:'wholesale_'+config.kind,theme:'auto',
        execution:'execute',appearance:'interaction-only',
        callback:function(value){finish(null,value);},
        'error-callback':function(){finish(Error('Verification failed. Please try again.'));return true;},
        'expired-callback':function(){finish(Error('Verification expired. Please try again.'));},
        'timeout-callback':function(){finish(Error('Verification timed out. Please try again.'));}
      });
      turnstile.execute(id);
    });
  }
  window.ocSubmitWholesale = async function(form) {
    if(busy)return false;
    var config=window.OC_FORM,status=document.getElementById('formStatus');
    var button=form.querySelector('button[type="submit"]'),widget;
    busy=true;button.disabled=true;form.setAttribute('aria-busy','true');
    try {
      if(!config || !config.sitekey || config.sitekey.indexOf('REPLACE_')===0) throw Error('Ordering verification is being configured. Please try again shortly.');
      status.textContent='Verifying your submission…';status.classList.remove('error');
      widget=await token(config);
      var key=randomHex(32),body=new FormData(form);
      body.set('cf-turnstile-response',widget.value);body.set('oc_response_key',key);
      status.textContent='Submitting order…';
      // A network error can occur after the server accepts the order. Always
      // check its acknowledgement before inviting a retry; never resend automatically.
      await Promise.race([
        fetch(form.action,{method:'POST',mode:'no-cors',body:body}).catch(function(){}),pause(20000)
      ]);
      var deadline=Date.now()+60000;
      while(Date.now()<deadline) {
        var result=await response(form.action,key);
        if(result && result.ok===true)return true;
        if(result && result.code!=='pending_response') {
          var messages={
            rate_limited:'Several orders were submitted recently. Please wait 15 minutes before trying again.',
            pending:'This order may already be processing. Please check your confirmation email before submitting again.',
            delivery_uncertain:'We could not confirm delivery. Please check your confirmation email before submitting again.',
            verification_required:'Please complete verification and try again.',
            verification_failed:'Verification expired or failed. Please try again.',
            invalid_design:'A selected design is no longer available. Please refresh the gallery and review your selections.',
            minimum_quantity:'Please review your selections and meet the wholesale minimum.',
            invalid_totals:'Please refresh and review your order totals before submitting again.',
            required_field:'Please complete all required customer and shipping fields.',
            invalid_email:'Please check your email address.',
            invalid_field:'Please check your customer and shipping details.'
          };
          throw Error(messages[result.code]||'Your order could not be confirmed. Your selections are saved. Please try again later.');
        }
        await pause(1500);
      }
      throw Error('We could not confirm whether your order was received. Your selections are saved. Please check your email before submitting again.');
    } catch(error) {
      status.textContent=error.message;status.classList.add('error');return false;
    } finally {
      if(widget && window.turnstile)turnstile.remove(widget.id);
      busy=false;button.disabled=false;form.removeAttribute('aria-busy');
    }
  };
})();
