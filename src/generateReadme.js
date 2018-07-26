const fs = require('fs');

const toml = require('toml');
const groupBy = require('lodash/groupBy');
const sortBy = require('lodash/sortBy');
const compact = require('lodash/compact');
const find = require('lodash/find');
const { camelizeKeys } = require('humps');
const Xray = require('x-ray');
const Handlebars = require('handlebars');
const moment = require('moment');
const glob = require('glob');

const x = Xray({
  filters: {
    removeCommas(value) {
      return value && value.replace(',', '');
    },
    trim(value) {
      return value && value.trim();
    },
    toInt(value) {
      return value && parseInt(value, 10);
    },
    toMoment(value) {
      return moment(value);
    },
  },
});

// From https://git.io/viRqj
const anchorify = (text) => (
  text.toLowerCase()
    .split(/ /)
    .join('-')
    .split(/\t/)
    .join('--')
    .split(/[|$&`~=\\\/@+*!?({[\]})<>=.,;:'"^]/)
    .join('')
);

const GITHUB_URL = 'https://github.com';

const numberWithCommas = (n) => (
  n && n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
);

const fetchGitHubDetails = (githubURL) => (
  new Promise((resolve, reject) => {
    x(githubURL, {
      starCount: '.js-social-count | trim | removeCommas | toInt',
      lastCommit: 'relative-time@datetime | trim | toMoment',
    })((err, data) => {
      if (err) {
        console.error(`Error scraping ${githubURL}`, err);
        return reject(err);
      }
      return resolve(data);
    });
  })
);

// Find duplicate entries in an array of objects for a given key.
const duplicatesForKey = (objectArray, key) => (
  objectArray.filter((object, index) => (
    object[key] && find(objectArray.slice(index + 1), [key, object[key]])
  )).map((object) => object[key])
);

const generateReadme = () => {
  const readmeTemplate = Handlebars.compile(
    fs.readFileSync('./README.md.hbs').toString()
  );

  const metaContents = fs.readFileSync('./meta.toml');
  const meta = camelizeKeys(toml.parse(metaContents));
  const dataFiles = glob.sync('data/*.toml');
  const allGraphqls = dataFiles.map((dataFile) => (
    camelizeKeys(toml.parse(fs.readFileSync(dataFile)))
  ));

  const duplicateURLS = duplicatesForKey(allGraphqls, 'url');
  const duplicateGithubRepos = duplicatesForKey(allGraphqls, 'githubRepo');

  if (duplicateURLS.length) {
    console.error(`Duplciate url found: ${duplicateURLS}`);
  }
  if (duplicateGithubRepos.length) {
    console.error(`Duplciate github_repo found: ${duplicateGithubRepos}`);
  }

  const { languagesToHuman } = meta;
  const graphqlsByLanguage = groupBy(allGraphqls, 'language');
  const languageKeys = Object.keys(graphqlsByLanguage).sort();

  const tocEntries = languageKeys.map((key) => {
    let humanName = languagesToHuman[key];
    if (!humanName) {
      console.error(
        `Human name missing for "${key}" language. Add it to meta.toml`
      );
      humanName = key;
    }
    return {
      text: humanName,
      anchor: anchorify(humanName),
    };
  });

  return Promise.all(languageKeys.map((key) => {
    const graphqlsForLanguage = graphqlsByLanguage[key];

    const graphqlPromises = graphqlsForLanguage.map(
      ({ awesomeRepo, name, description, githubRepo, url }) => {
        const githubURL = githubRepo && `${GITHUB_URL}/${githubRepo}`;
        const awesomeURL = awesomeRepo && `${GITHUB_URL}/${awesomeRepo}`;

        if (githubRepo) {
          return fetchGitHubDetails(githubURL).then(({ starCount, lastCommit }) => {
            if (typeof starCount !== 'number') {
              throw new Error(`Error: no star count for ${githubURL}`);
            }
            return {
              awesomeURL,
              name,
              githubURL,
              starCount,
              starCountText: numberWithCommas(starCount),
              lastCommit: lastCommit.format('YYYY/MM/DD'),
              url,
              description,
            };
          });
        }

        return {
          awesomeURL,
          name,
          url,
          description,
        };
      }
    );

    return Promise.all(graphqlPromises).then((graphqls) => {
      // Sort by star count or name if starCount not available.
      const sortedGraphqls = graphqls[0].githubURL ?
        sortBy(graphqls, ({ starCount }) => starCount).reverse()
        :
        sortBy(graphqls, ({ name }) => name.toLowerCase());

      return {
        name: languagesToHuman[key],
        headerColumns: compact([
          '名称',
          '描述',
        ]),
        graphqls: sortedGraphqls,
      };
    });
  })).then((graphqlGroups) => {
    fs.writeFileSync('README.md', readmeTemplate({
      graphqlCount: allGraphqls.length,
      graphqlGroups,
      generationTime: moment().format('MMMM Do, YYYY'),
      tocEntries,
    }));

    return allGraphqls;
  });
};

module.exports = generateReadme;