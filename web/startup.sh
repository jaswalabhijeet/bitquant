#!/bin/bash -v

sudo systemctl restart httpd
#ipython notebook &

if [ -d ../../OG-Platform ] ; then
pushd ../../OG-Platform/examples/examples-bitquant/
mvn install
mvn opengamma:server-start -Dconfig=fullstack
popd
fi



