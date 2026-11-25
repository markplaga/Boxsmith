/* Boxsmith launch settings.
   Empty values do nothing: no analytics script is loaded, and follow/tip links stay hidden.
   How to fill this in: see README.md, "Analytics" and "Follow and tip links". */
var BOXSMITH_CONFIG = {
  /* Privacy-friendly, cookie-free analytics. Leave '' until you have an account.
       'goatcounter:yourcode'     yourcode is the name you picked at goatcounter.com
                                  (the script loads from https://yourcode.goatcounter.com)
       'goatcounter:https://stats.example.com/count'   a self-hosted GoatCounter
       'plausible:markplaga.github.io'                 the domain you added at plausible.io
       'plausible:markplaga.github.io@https://plausible.example.com'   self-hosted Plausible
     Nothing is requested, and no cookie is set, while this is empty. */
  analytics: '',

  /* Follow and tip links. Each one is hidden while it is empty.
     Use a full https URL, for example 'https://instagram.com/yourname'. */
  links: {
    instagram: '',
    youtube: '',
    kofi: ''
  }
};
