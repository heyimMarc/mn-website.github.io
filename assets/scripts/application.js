/*
 * Override of Toha's application.js.
 *
 * The theme imports @fortawesome/fontawesome-free/js/all, which registers
 * every icon Font Awesome ships: 1.49 MB of minified JS, by itself most of
 * the 1.28 MB production bundle every visitor downloaded. The site uses
 * twenty-seven icons. They are registered explicitly here through
 * fontawesome-svg-core, and dom.watch() still converts the theme's
 * <i class="fab fa-github"> markup to inline SVG exactly as before.
 *
 * The list is the union of every fa-* class in the theme's layouts (share
 * buttons, pagers, heading anchors, contact icons, the image-zoom shortcode)
 * and in data/en (skills, social links, experience locations). A new icon
 * added anywhere has to be added here too, or Font Awesome renders its
 * "missing icon" placeholder and logs "Could not find icon" in the console.
 *
 * To re-derive the list:
 *   grep -rhoE '\bfa-[a-z0-9-]+' layouts data <theme>/layouts | sort -u
 *
 * Everything below the icon block is the theme's own file, unchanged.
 */
import 'popper.js'
import 'bootstrap'

import { library, dom } from '@fortawesome/fontawesome-svg-core'
import {
  faChevronDown, faChevronCircleLeft, faChevronCircleRight, faChevronCircleUp,
  faCodeBranch, faEnvelope, faEnvelopeOpenText, faPhoneAlt,
  faCubes, faRobot, faStream,
  faLink, faLocationDot, faMagnifyingGlassPlus, faXmark
} from '@fortawesome/free-solid-svg-icons'
import {
  faDiaspora, faFacebook, faGetPocket, faGithub, faLinkedin, faMastodon,
  faReddit, faResearchgate, faTumblr, faTwitter, faWhatsapp, faStackOverflow
} from '@fortawesome/free-brands-svg-icons'

library.add(
  faChevronDown, faChevronCircleLeft, faChevronCircleRight, faChevronCircleUp,
  faCodeBranch, faEnvelope, faEnvelopeOpenText, faPhoneAlt,
  faCubes, faRobot, faStream,
  faLink, faLocationDot, faMagnifyingGlassPlus, faXmark,
  faDiaspora, faFacebook, faGetPocket, faGithub, faLinkedin, faMastodon,
  faReddit, faResearchgate, faTumblr, faTwitter, faWhatsapp, faStackOverflow
)
dom.watch()

import feather from 'feather-icons'

import './core'
import './features'
import './sections'
import './pages'

feather.replace();
