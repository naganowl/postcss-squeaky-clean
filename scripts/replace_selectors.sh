#/usr/bin/bash

# Given CSS selectors, remove instances of them from all files provided

SQKD_SELECTORS=$1
WHITELIST_FILES=`echo $2 | tr ',' '\n'`

SANITIZED_SELECTORS=`echo "$SQKD_SELECTORS" | tr ' ' '\n' | grep sqkd | sort -u | cut -c2-`

if [[ `echo $WHITELIST_FILES` ]]
then
  SANITIZED_FILES=`echo "$WHITELIST_FILES" | grep -v "$3"`
else
  SANITIZED_SELECTORS=`echo $1 | tr ',' '\n'`
fi

COUNTER=0
for i in $SANITIZED_SELECTORS ; do
  if [[ `echo $SANITIZED_FILES` ]]
  then
    echo "$SANITIZED_FILES" | xargs sed -i '' "s/ $i//";
  else
    REPLACEABLE_FILES=`grep -rl "$i" app config engines frontend lib`
    BASE_SELECTOR=`echo "$i" | cut -d- -f1`
    SELECTOR_SUFFIX=`echo "$i" | cut -d- -f2-`
    NEW_SELECTOR="${BASE_SELECTOR}${COUNTER}-${SELECTOR_SUFFIX}"
    COUNTER=$((COUNTER+1))
    echo "$REPLACEABLE_FILES" | xargs sed -i '' "s/$i/$NEW_SELECTOR/";
    echo "$NEW_SELECTOR"
    echo "$NEW_SELECTOR" >> tmp/newSelectors
  fi
done
